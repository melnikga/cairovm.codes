import React, {
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { decode, encode } from '@kunigi/string-compression'
import cn from 'classnames'
import copy from 'copy-to-clipboard'
import { Priority, useRegisterActions } from 'kbar'
import { useRouter } from 'next/router'
import SCEditor from 'react-simple-code-editor'

import {
  CairoVMApiContext,
  ProgramCompilationState,
  ProgramExecutionState,
} from 'context/cairoVMApiContext'
import { Setting, SettingsContext } from 'context/settingsContext'

import { getAbsoluteURL } from 'util/browser'
import { isArgumentStringValid } from 'util/compiler'
import { codeHighlight, isEmpty, objToQueryString } from 'util/string'

import examples from 'components/Editor/examples'
import { Tracer } from 'components/Tracer'

import { AppUiContext, CodeType, LogType } from '../../context/appUiContext'

import { ArgumentsHelperModal } from './ArgumentsHelperModal'
import EditorControls from './EditorControls'
import ExtraColumn from './ExtraColumn'
import Header from './Header'
import { InstructionsTable } from './InstructionsTable'

type Props = {
  readOnly?: boolean
}

type SCEditorRef = {
  _input: HTMLTextAreaElement
} & RefObject<React.FC>

const cairoEditorHeight = 350

function isCommentLine(input: string) {
  return input.startsWith('// ')
}

const Editor = ({ readOnly = false }: Props) => {
  const { settingsLoaded, getSetting } = useContext(SettingsContext)
  const router = useRouter()

  const {
    compilationState,
    executionState,
    executionPanicMessage,
    compileCairoCode,
    cairoLangCompilerVersion,
    serializedOutput,
    casmInstructions,
    activeCasmInstructionIndex,
    sierraStatements,
    casmToSierraMap,
    currentSierraVariables,
    logs: apiLogs,
    cairoLocation,
  } = useContext(CairoVMApiContext)

  const { addToConsoleLog, isThreeColumnLayout } = useContext(AppUiContext)

  const [cairoCode, setCairoCode] = useState('')
  const [exampleOption, setExampleOption] = useState<number>(0)
  const [codeType, setCodeType] = useState<string | undefined>()
  const [programArguments, setProgramArguments] = useState<string>('')

  const editorRef = useRef<SCEditorRef>()
  const [showArgumentsHelper, setShowArgumentsHelper] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    const query = router.query

    if ('codeType' in query && 'code' in query) {
      setCodeType(query.codeType as string)
      setCairoCode(JSON.parse('{"a":' + decode(query.code as string) + '}').a)
    } else {
      const initialCodeType: CodeType =
        getSetting(Setting.EditorCodeType) || CodeType.Cairo

      setCodeType(initialCodeType)
      setCairoCode(examples[initialCodeType][exampleOption])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded && router.isReady, exampleOption])

  useEffect(() => {
    if (compilationState === ProgramCompilationState.Compiling) {
      addToConsoleLog('Compiling...')
      return
    }

    if (compilationState === ProgramCompilationState.CompilationSuccess) {
      addToConsoleLog('Compilation successful')

      if (serializedOutput) {
        addToConsoleLog(`Execution output: ${serializedOutput}`)
      }
    } else if (compilationState === ProgramCompilationState.CompilationErr) {
      addToConsoleLog('Compilation failed', LogType.Error)
    }

    if (executionState === ProgramExecutionState.Error) {
      addToConsoleLog('Runtime error: ' + executionPanicMessage, LogType.Error)
    }

    // Compilation finished, log the API logs, if any
    for (const apiLogEntry of apiLogs) {
      let log_type
      if (apiLogEntry.log_type == 'Error') {
        log_type = LogType.Error
      } else if (apiLogEntry.log_type == 'Warn') {
        log_type = LogType.Warn
      } else {
        log_type = LogType.Info
      }

      addToConsoleLog(apiLogEntry.message, log_type)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    compilationState,
    executionState,
    serializedOutput,
    apiLogs,
    executionPanicMessage,
  ])

  const handleCairoCodeChange = (value: string) => {
    setCairoCode(value)
  }

  const highlightCode = (value: string, codeType: string | undefined) => {
    if (!codeType) {
      return value
    }

    let _codeType = codeType

    if (_codeType === CodeType.Sierra) {
      _codeType = CodeType.Cairo
    }

    if (_codeType === CodeType.CASM) {
      _codeType = 'bytecode'
    }
    type TextIndices = {
      text: string
      startStr: number
      endStr: number
    }

    function findTextIndices(html: string): TextIndices[] {
      const indices: TextIndices[] = []
      const tagPattern = /<\/?[^>]+>/g
      let match
      let lastIndex = 0
      while ((match = tagPattern.exec(html)) !== null) {
        const textBetweenTags = html.substring(lastIndex, match.index)
        if (textBetweenTags) {
          indices.push({
            text: textBetweenTags,
            startStr: lastIndex,
            endStr: match.index,
          })
        }
        lastIndex = match.index + match[0].length
      }

      const trailingText = html.substring(lastIndex)
      if (trailingText) {
        indices.push({
          text: trailingText,
          startStr: lastIndex,
          endStr: html.length,
        })
      }

      return indices
    }
    console.log(cairoLocation)
    const newValue = value.split('\n')
    return codeHighlight(value, _codeType)
      .value.split('\n')
      .map((line, i) => {
        if (
          cairoLocation &&
          Object.keys(cairoLocation).length !== 0 &&
          activeCasmInstructionIndex !== null
        ) {
          const textIndices = findTextIndices(line)
          const cairoCoordinates = newValue[i].slice(
            cairoLocation[activeCasmInstructionIndex]?.cairo_location?.start
              .col - 1,
            cairoLocation[activeCasmInstructionIndex]?.cairo_location?.end
              ?.col + 1,
          )
          const range =
            cairoLocation[activeCasmInstructionIndex]?.cairo_location?.end
              ?.col -
            1 -
            cairoLocation[activeCasmInstructionIndex]?.cairo_location?.start
              .col +
            1
          let newLine
          textIndices.map((item) => {
            if (
              (item.text.trim().includes(cairoCoordinates.trim()) ||
                cairoCoordinates.trim().includes(item.text.trim())) &&
              cairoLocation[activeCasmInstructionIndex]?.cairo_location?.start
                ?.line === i
            ) {
              if (
                cairoLocation[activeCasmInstructionIndex]?.cairo_location?.end
                  ?.line !== i
              ) {
                newLine =
                  line.slice(
                    0,
                    line.slice(item.startStr).indexOf(cairoCoordinates),
                  ) +
                  '<span class="bg-red-100">' +
                  line.slice(
                    line.slice(item.startStr).indexOf(cairoCoordinates),
                    item.endStr,
                  ) +
                  '</span>' +
                  line.slice(item.endStr)
                console.log('moreonelines')
              } else {
                if (item.text.trim().includes(cairoCoordinates)) {
                  console.log('odnalines')
                  newLine =
                    line.slice(0, item.startStr) +
                    line.slice(
                      item.startStr,
                      item.startStr +
                        line.slice(item.startStr).indexOf(cairoCoordinates),
                    ) +
                    '<span class="bg-red-100">' +
                    line.slice(
                      item.startStr +
                        line.slice(item.startStr).indexOf(cairoCoordinates),
                      item.startStr +
                        line.slice(item.startStr).indexOf(cairoCoordinates) +
                        range,
                    ) +
                    '</span>' +
                    line.slice(
                      item.startStr +
                        line.slice(item.startStr).indexOf(cairoCoordinates) +
                        range,
                    )
                  console.log(
                    'line: \n' + line + '\n',
                    'newLine: \n' + newLine + '\n',
                    'item.text: \n' + item.text + '\n',
                    'item.startStr: \n' + item.startStr + '\n',
                    'cairoCoordinates: \n' + cairoCoordinates + '\n',
                    'line.indexOf(cairoCoordinates): \n' +
                      line.indexOf(cairoCoordinates) +
                      '\n',
                    'newValue: \n' + newValue[i] + '\n',
                    'line.slice(item.startStr).indexOf(cairoCoordinates): \n' +
                      line.slice(item.startStr).indexOf(cairoCoordinates) +
                      '\n',
                  )
                } else if (cairoCoordinates.includes(item.text.trim())) {
                  newLine =
                    line.slice(
                      0,
                      line.indexOf(cairoCoordinates) !== -1
                        ? line.indexOf(cairoCoordinates)
                        : item.startStr,
                    ) +
                    '<span class="bg-red-100">' +
                    line.slice(
                      line.indexOf(cairoCoordinates) !== -1
                        ? line.indexOf(cairoCoordinates)
                        : item.startStr,
                      item.endStr,
                    ) +
                    '</span>' +
                    line.slice(item.endStr)
                  console.log(
                    'elseif',
                    'line: \n' + line + '\n',
                    'newLine: \n' + newLine + '\n',
                    'item.text: \n' + item.text + '\n',
                    'item.startStr: \n' + item.startStr + '\n',
                    'cairoCoordinates: \n' + cairoCoordinates + '\n',
                    'line.indexOf(cairoCoordinates): \n' +
                      line.indexOf(cairoCoordinates) +
                      '\n',
                    'newValue: \n' + newValue[i] + '\n',
                    'line.slice(item.startStr).indexOf(cairoCoordinates): \n' +
                      line.slice(item.startStr).indexOf(cairoCoordinates) +
                      '\n',
                  )
                }
              }
            } else {
              if (
                cairoLocation[activeCasmInstructionIndex]?.cairo_location?.start
                  ?.line < i &&
                i <
                  cairoLocation[activeCasmInstructionIndex]?.cairo_location?.end
                    ?.line
              ) {
                newLine =
                  line.slice(
                    0,
                    line.slice(item.startStr).indexOf(cairoCoordinates),
                  ) +
                  '<span class="bg-red-100">' +
                  line.slice(
                    line.slice(item.startStr).indexOf(cairoCoordinates),
                    item.endStr,
                  ) +
                  '</span>' +
                  line.slice(item.endStr)
                console.log(
                  'else',
                  'line: \n' + line + '\n',
                  'newLine: \n' + newLine + '\n',
                  'item.text: \n' + item.text + '\n',
                  'item.startStr: \n' + item.startStr + '\n',
                  'cairoCoordinates: \n' + cairoCoordinates + '\n',
                  'line.indexOf(cairoCoordinates): \n' +
                    line.indexOf(cairoCoordinates) +
                    '\n',
                  'newValue: \n' + newValue[i] + '\n',
                  'line.slice(item.startStr).indexOf(cairoCoordinates): \n' +
                    line.slice(item.startStr).indexOf(cairoCoordinates) +
                    '\n',
                )
              }
            }
          })
          return `<span class='line-number'>${i + 1}</span>${
            newLine ? newLine : line
          }`
        }
        return `<span class='line-number'>${i + 1}</span>${line}`
      })
      .join('\n')
  }

  const removeExtraWhitespaces = (value: string) => {
    const sanitizedValue = value.trim().replace(/\s+/g, ' ')
    return sanitizedValue
  }

  const handleProgramArgumentsUpdate = useCallback(
    (_programArguments: string) => {
      setProgramArguments(_programArguments)
    },
    [setProgramArguments],
  )

  const handleCompileRun = useCallback(() => {
    compileCairoCode(cairoCode, removeExtraWhitespaces(programArguments))
  }, [cairoCode, programArguments, compileCairoCode])

  const handleCopyPermalink = useCallback(() => {
    const params = {
      codeType,
      code: encodeURIComponent(encode(JSON.stringify(cairoCode))),
    }

    copy(`${getAbsoluteURL('/')}?${objToQueryString(params)}`)
    addToConsoleLog('Link with current Cairo code copied to clipboard')
  }, [cairoCode, codeType, addToConsoleLog])

  const areProgramArgumentsValid = useMemo(() => {
    const sanitizedArguments = removeExtraWhitespaces(programArguments)
    return isArgumentStringValid(sanitizedArguments)
  }, [programArguments])

  const isCompileDisabled = useMemo(() => {
    return (
      compilationState === ProgramCompilationState.Compiling ||
      isEmpty(cairoCode)
    )
  }, [compilationState, cairoCode])

  const isBytecode = false

  const actions = [
    {
      id: 'cairo',
      name: 'Cairo',
      shortcut: ['x'],
      keywords: 'Cairo',
      section: 'Execution',
      perform: () => {
        setCodeType(CodeType.Cairo)
      },
      subtitle: 'Switch to Cairo',
      priority: Priority.HIGH,
    },
    {
      id: 'sierra',
      name: 'Sierra',
      shortcut: ['s'],
      keywords: 'Sierra',
      section: 'Execution',
      perform: () => {
        setCodeType(CodeType.Sierra)
      },
      subtitle: 'Switch to Sierra',
      priority: Priority.HIGH,
    },
    {
      id: 'casm',
      name: 'Casm',
      shortcut: ['w'],
      keywords: 'Casm',
      section: 'Execution',
      perform: () => {
        setCodeType(CodeType.CASM)
      },
      subtitle: 'Switch to Casm',
      priority: Priority.HIGH,
    },
  ]
  useRegisterActions(actions, [highlightCode])

  const handleCommentLine = useCallback(() => {
    if (!editorRef.current) {
      return
    }
    const textareaRef = editorRef.current._input
    const selectionLineNumberStart = cairoCode
      .substring(0, textareaRef.selectionStart)
      .split('\n').length
    const selectionLineNumberEnd = cairoCode
      .substring(0, textareaRef.selectionEnd)
      .split('\n').length

    const selectionStart = textareaRef.selectionStart
    const selectionEnd = textareaRef.selectionEnd
    const lines = cairoCode.split('\n')
    const linesToComment: number[] = []
    for (let k = selectionLineNumberStart; k <= selectionLineNumberEnd; k++) {
      linesToComment.push(k)
    }

    const isMultilineSelection = linesToComment.length > 1
    let charOffsetStart = 0
    let charOffsetEnd = 0
    if (isMultilineSelection) {
      for (const lineNumber of linesToComment) {
        if (lines[lineNumber - 1] !== undefined) {
          const line = lines[lineNumber - 1]
          if (isCommentLine(line)) {
            lines[lineNumber - 1] = line.substring(3)
            charOffsetEnd -= 3
          } else {
            lines[lineNumber - 1] = '// ' + line
            charOffsetEnd += 3
          }
        }
      }
    } else {
      const lineNumber = linesToComment[0]
      const line = lines[lineNumber - 1]
      if (isCommentLine(line)) {
        lines[lineNumber - 1] = line.substring(3)
        charOffsetStart = -3
        charOffsetEnd = -3
      } else {
        lines[lineNumber - 1] = '// ' + line
        charOffsetStart = 3
        charOffsetEnd = 3
      }
    }

    setCairoCode(lines.join('\n'))
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(
      () =>
        textareaRef.setSelectionRange(
          selectionStart + charOffsetStart,
          selectionEnd + charOffsetEnd,
        ),
      0,
    )
  }, [cairoCode])

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault()
        handleCommentLine()
      }
    }
    document.addEventListener('keydown', handleKeyPress)
    return () => {
      document.removeEventListener('keydown', handleKeyPress)
    }
  }, [handleCommentLine, cairoCode])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // console.log(cairoCode)

  return (
    <>
      <div className="bg-gray-100 dark:bg-black-700 rounded-lg">
        <div className="flex flex-col md:flex-row">
          <div
            className={cn(
              'w-full md:w-1/2 flex flex-col',
              isThreeColumnLayout && 'md:w-1/3',
            )}
          >
            <div className="border-b border-gray-200 dark:border-black-500 flex items-center pl-6 pr-2 h-14 md:border-r">
              <Header
                codeType={codeType}
                onCodeTypeChange={({ value }) => setCodeType(value)}
              />
            </div>

            <div
              className="relative pane grow pane-light overflow-auto md:border-r bg-gray-50 dark:bg-black-600 border-gray-200 dark:border-black-500"
              style={{ height: cairoEditorHeight }}
            >
              {codeType === CodeType.CASM ? (
                <InstructionsTable
                  instructions={casmInstructions}
                  codeType={codeType}
                  activeIndexes={[activeCasmInstructionIndex]}
                  variables={{}}
                />
              ) : codeType === CodeType.Sierra ? (
                <InstructionsTable
                  instructions={sierraStatements}
                  codeType={codeType}
                  activeIndexes={
                    casmToSierraMap[activeCasmInstructionIndex] ?? []
                  }
                  variables={currentSierraVariables || {}}
                />
              ) : (
                <SCEditor
                  // @ts-ignore: SCEditor is not TS-friendly
                  ref={editorRef}
                  id="myTextarea"
                  value={codeType === CodeType.Cairo ? cairoCode : ''}
                  readOnly={readOnly}
                  onValueChange={handleCairoCodeChange}
                  highlight={(value) => highlightCode(value, codeType)}
                  tabSize={4}
                  className={cn('code-editor', {
                    'with-numbers': !isBytecode,
                  })}
                  preClassName="bg-red-100"
                  textareaClassName="bg-red-100"
                />
              )}
            </div>

            <EditorControls
              isCompileDisabled={isCompileDisabled}
              programArguments={programArguments}
              areProgramArgumentsValid={areProgramArgumentsValid}
              onCopyPermalink={handleCopyPermalink}
              onProgramArgumentsUpdate={handleProgramArgumentsUpdate}
              onCompileRun={handleCompileRun}
              onShowArgumentsHelper={() => setShowArgumentsHelper(true)}
              exampleName={exampleOption}
              handleChangeExampleOption={(newExample) =>
                newExample !== null
                  ? setExampleOption(newExample.value)
                  : setExampleOption(0)
              }
            />
          </div>

          {isThreeColumnLayout && (
            <ExtraColumn
              cairoCode={cairoCode}
              cairoEditorHeight={cairoEditorHeight}
              highlightCode={highlightCode}
              isBytecode={isBytecode}
            />
          )}

          <div
            className={cn(
              'w-full md:w-1/2 flex flex-col',
              isThreeColumnLayout && 'md:w-1/3',
            )}
          >
            <Tracer mainHeight={cairoEditorHeight} />
          </div>
        </div>

        <div className="rounded-b-lg py-2 px-4 border-t bg-gray-800 dark:bg-black-700 border-black-900/25 text-gray-400 dark:text-gray-600 text-xs">
          {cairoLangCompilerVersion !== ''
            ? `Cairo Compiler v${cairoLangCompilerVersion}`
            : ' '}
        </div>
      </div>
      <ArgumentsHelperModal
        showArgumentsHelper={showArgumentsHelper}
        setShowArgumentsHelper={setShowArgumentsHelper}
      />
    </>
  )
}

export default Editor
