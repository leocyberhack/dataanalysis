import axios from 'axios';

const isLocalDevHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const defaultApiUrl = isLocalDevHost
  ? `http://${window.location.hostname}:8001`
  : '';
const GET_CACHE_TTL_MS = 30 * 1000;
const getResponseCache = new Map();
const inflightGetRequests = new Map();
let cacheVersion = 0;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultApiUrl,
});

const sortParams = (params = {}) => Object.fromEntries(
  Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
);

const buildCacheKey = (endpoint, params = {}) => {
  const normalizedParams = sortParams(params);
  const searchParams = new URLSearchParams();
  Object.entries(normalizedParams).forEach(([key, value]) => {
    searchParams.append(key, String(value));
  });
  return `${endpoint}?${searchParams.toString()}`;
};

const cloneCachedValue = (value) => {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch {
    // structuredClone may throw for non-cloneable values; fall through to JSON
  }
  return JSON.parse(JSON.stringify(value));
};

const invalidateApiCache = () => {
  cacheVersion++;
  getResponseCache.clear();
};

const cachedGet = async (endpoint, params = {}, ttlMs = GET_CACHE_TTL_MS) => {
  const cacheKey = buildCacheKey(endpoint, params);
  const cachedEntry = getResponseCache.get(cacheKey);
  const now = Date.now();

  if (cachedEntry && now - cachedEntry.timestamp < ttlMs && cachedEntry.version === cacheVersion) {
    return cloneCachedValue(cachedEntry.value);
  }

  if (inflightGetRequests.has(cacheKey)) {
    return cloneCachedValue(await inflightGetRequests.get(cacheKey));
  }

  const requestVersion = cacheVersion;
  const requestPromise = api.get(endpoint, { params }).then((response) => {
    inflightGetRequests.delete(cacheKey);
    if (requestVersion === cacheVersion) {
      getResponseCache.set(cacheKey, {
        timestamp: Date.now(),
        value: response.data,
        version: requestVersion,
      });
    }
    return response.data;
  }).catch((error) => {
    inflightGetRequests.delete(cacheKey);
    throw error;
  });

  inflightGetRequests.set(cacheKey, requestPromise);
  return cloneCachedValue(await requestPromise);
};

export const uploadData = async (date, file) => {
  const formData = new FormData();
  formData.append('date', date);
  formData.append('file', file);
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  invalidateApiCache();
  return response;
};

export const uploadOrderData = async (date, file) => {
  const formData = new FormData();
  formData.append('date', date);
  formData.append('file', file);
  const response = await api.post('/upload_orders', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  invalidateApiCache();
  return response;
};

export const getDates = async () => {
  const data = await cachedGet('/dates');
  return data.dates;
};

export const getDateStatus = async () => {
  return cachedGet('/date_status');
};

export const getProducts = async (startDate, endDate) => {
  const params = {};
  if (startDate && endDate) {
    params.startDate = startDate;
    params.endDate = endDate;
  }
  return cachedGet('/products', params);
};

export const getPois = async (startDate, endDate) => {
  const params = {};
  if (startDate && endDate) {
    params.startDate = startDate;
    params.endDate = endDate;
  }
  return cachedGet('/pois', params);
};

const normalizeGroupFilters = (filters = null) => {
  if (Array.isArray(filters)) {
    return { mode: 'product', values: filters };
  }

  if (!filters || typeof filters !== 'object') {
    return { mode: 'product', values: [] };
  }

  const mode = filters.mode === 'poi' ? 'poi' : 'product';
  const values = Array.isArray(filters.values) ? filters.values : [];
  return { mode, values };
};

const appendGroupFilters = (params, filters = null) => {
  const normalized = normalizeGroupFilters(filters);
  if (normalized.values.length === 0) {
    return normalized;
  }

  if (normalized.mode === 'poi') {
    params.poiNames = normalized.values.join(',');
  } else {
    params.productIds = normalized.values.join(',');
  }

  return normalized;
};

export const getSummary = async (startDate, endDate, filters = null) => {
  const params = { startDate, endDate: endDate || startDate };
  appendGroupFilters(params, filters);
  return cachedGet('/summary', params);
};

export const getDetailedData = async (startDate, endDate, productIds = null) => {
  const params = { startDate, endDate };
  if (productIds && productIds.length > 0) {
    params.productIds = productIds.join(',');
  }
  return cachedGet('/data', params);
};

export const getCompareAggregate = async (startDate, endDate, filters = null, metrics = null) => {
  const params = { startDate, endDate };
  const normalizedFilters = appendGroupFilters(params, filters);
  params.groupBy = normalizedFilters.mode;
  if (metrics && metrics.length > 0) {
    params.metrics = metrics.join(',');
  }
  return cachedGet('/compare/aggregate', params);
};

const normalizeCompareTrendResponse = (payload) => {
  if (Array.isArray(payload)) {
    const dates = Array.from(new Set(
      payload
        .map((row) => row?.date)
        .filter(Boolean),
    )).sort();

    return {
      dates,
      rows: payload,
    };
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const dates = Array.isArray(payload?.dates)
    ? payload.dates
    : Array.from(new Set(rows.map((row) => row?.date).filter(Boolean))).sort();

  return { dates, rows };
};

export const getCompareTrend = async (startDate, endDate, metric, filters = null) => {
  const params = {
    startDate,
    endDate,
    metric,
    includeDates: true,
  };
  const normalizedFilters = appendGroupFilters(params, filters);
  params.groupBy = normalizedFilters.mode;
  const payload = await cachedGet('/compare/trend', params);
  return normalizeCompareTrendResponse(payload);
};

export const deleteData = async (date) => {
  const res = await api.delete('/data', { params: { date } });
  invalidateApiCache();
  return res.data;
};

export const deleteCommodityData = async (date) => {
  const res = await api.delete('/data/commodity', { params: { date } });
  invalidateApiCache();
  return res.data;
};

export const deleteOrderData = async (date) => {
  const res = await api.delete('/data/order', { params: { date } });
  invalidateApiCache();
  return res.data;
};

// ===== Order Review APIs =====
export const getPendingOrders = async () => {
  const res = await api.get('/pending_orders');
  return res.data;
};

export const approveOrder = async (orderId, profit = null) => {
  const payload = profit === null || profit === undefined ? undefined : { profit };
  const res = await api.post(`/approve_order/${orderId}`, payload);
  invalidateApiCache();
  return res.data;
};

export const updateOrderProfit = async (orderId, profit) => {
  const res = await api.put(`/pending_order/${orderId}`, { profit });
  invalidateApiCache();
  return res.data;
};

export const deletePendingOrder = async (orderId) => {
  const res = await api.delete(`/pending_order/${orderId}`);
  invalidateApiCache();
  return res.data;
};
