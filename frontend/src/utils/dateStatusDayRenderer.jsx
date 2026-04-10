import DateStatusDay from '../components/DateStatusDay';

export const createDateStatusDayRenderer = (dateStatus, options = {}) => {
  const { compact = false } = options;

  function renderDateStatusDay(day, date) {
    return (
      <DateStatusDay
        day={day}
        date={date}
        dateStatus={dateStatus}
        compact={compact}
      />
    );
  }

  return renderDateStatusDay;
};
