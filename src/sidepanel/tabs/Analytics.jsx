import { useState } from 'preact/hooks'
import { TrendGraph } from '../components/TrendGraph.jsx'
import { PnlCalendar } from '../components/PnlCalendar.jsx'

export function Analytics({ snapshots }) {
  const [view, setView] = useState('trend')

  return (
    <div class="axpt-analytics">
      <div class="axpt-analytics-toggle">
        <button class={view === 'trend' ? 'axpt-tab-active' : ''} onClick={() => setView('trend')}>
          Trend
        </button>
        <button class={view === 'calendar' ? 'axpt-tab-active' : ''} onClick={() => setView('calendar')}>
          Calendar
        </button>
      </div>
      {view === 'trend' ? <TrendGraph snapshots={snapshots} /> : <PnlCalendar snapshots={snapshots} />}
    </div>
  )
}
