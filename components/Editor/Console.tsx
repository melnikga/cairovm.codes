import { useEffect, useContext, useRef } from 'react'

import { toKeyIndex } from 'util/string'

import { AppUiContext, LogType } from '../../context/appUiContext'

const Console = () => {
  const container = useRef<HTMLDivElement>(null)
  const endDiv = useRef<HTMLDivElement>(null)

  const { consoleLog } = useContext(AppUiContext)

  useEffect(() => {
    container.current?.parentElement?.scrollTo({
      top: endDiv.current?.offsetTop,
      behavior: 'smooth',
    })
  }, [consoleLog])

  return (
    <div ref={container} className="p-4">
      <p className="text-gray-500 dark:text-[#BDBDBD] font-medium uppercase text-[13px] leading-6">
        Console
      </p>
      <div className="leading-6 text-tiny text-gray-400 dark:text-darkMode-text">
        {consoleLog.map((log, index) => (
          <pre key={toKeyIndex('line', index)}>
            {log.type === LogType.Error && (
              <span className="text-red-500">[Error] </span>
            )}
            {log.type === LogType.Warn && (
              <span className="text-yellow-500">[Warn] </span>
            )}
            {log.message}
          </pre>
        ))}
        <div ref={endDiv}></div>
      </div>
    </div>
  )
}

export default Console
