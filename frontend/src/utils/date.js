const DAY_IN_MS = 24 * 60 * 60 * 1000;

const padNumber = (value) => String(value).padStart(2, '0');

export const parseStoredDate = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const normalizedValue = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizedValue);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsedDate = new Date(normalizedValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

export const getTodayDate = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export const formatDateKey = (value) => {
  const date = parseStoredDate(value);
  if (!date) {
    return '';
  }

  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate()),
  ].join('-');
};

export const formatDateRangeKeys = (startValue, endValue) => {
  const startKey = formatDateKey(startValue);
  const endKey = formatDateKey(endValue || startValue);

  return { startKey, endKey };
};

export const getInclusiveDayCount = (startValue, endValue) => {
  const startDate = parseStoredDate(startValue);
  const endDate = parseStoredDate(endValue || startValue);

  if (!startDate || !endDate) {
    return 1;
  }

  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const diffDays = Math.floor((endUtc - startUtc) / DAY_IN_MS);

  return diffDays >= 0 ? diffDays + 1 : 1;
};
