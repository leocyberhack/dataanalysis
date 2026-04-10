import { memo } from 'react';
import { formatDateKey } from '../utils/date';

function DateStatusDay({ day, date, dateStatus, compact = false }) {
  const status = dateStatus[formatDateKey(date)];
  const dotRowClassName = compact ? 'date-status-day-dots is-compact' : 'date-status-day-dots';

  return (
    <div className="date-status-day">
      <span className="date-status-day-number">{day}</span>
      <div className={dotRowClassName}>
        {status?.commodity && <span className="date-status-day-dot is-commodity" />}
        {status?.order && <span className="date-status-day-dot is-order" />}
      </div>
    </div>
  );
}

const MemoizedDateStatusDay = memo(DateStatusDay);
MemoizedDateStatusDay.displayName = 'DateStatusDay';

export default MemoizedDateStatusDay;
