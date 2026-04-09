import axios from 'axios';

const isLocalDevHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const defaultApiUrl = isLocalDevHost
  ? `http://${window.location.hostname}:8001`
  : '';
const GET_CACHE_TTL_MS = 30 * 1000;
const getResponseCache = new Map();
const inflightGetRequests = new Map();

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
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const invalidateApiCache = () => {
  getResponseCache.clear();
  inflightGetRequests.clear();
};

const cachedGet = async (endpoint, params = {}, ttlMs = GET_CACHE_TTL_MS) => {
  const cacheKey = buildCacheKey(endpoint, params);
  const cachedEntry = getResponseCache.get(cacheKey);
  const now = Date.now();

  if (cachedEntry && now - cachedEntry.timestamp < ttlMs) {
    return cloneCachedValue(cachedEntry.value);
  }

  if (inflightGetRequests.has(cacheKey)) {
    return cloneCachedValue(await inflightGetRequests.get(cacheKey));
  }

  const requestPromise = api.get(endpoint, { params }).then((response) => {
    getResponseCache.set(cacheKey, {
      timestamp: Date.now(),
      value: response.data,
    });
    inflightGetRequests.delete(cacheKey);
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

export const getSummary = async (startDate, endDate, productIds = null) => {
  const params = { startDate, endDate: endDate || startDate };
  if (productIds && productIds.length > 0) {
    params.productIds = productIds.join(',');
  }
  return cachedGet('/summary', params);
};

export const getDetailedData = async (startDate, endDate, productIds = null) => {
  const params = { startDate, endDate };
  if (productIds && productIds.length > 0) {
    params.productIds = productIds.join(',');
  }
  const res = await api.get('/data', { params });
  return res.data;
};

export const getCompareAggregate = async (startDate, endDate, productIds = null, metrics = null) => {
  const params = { startDate, endDate };
  if (productIds && productIds.length > 0) {
    params.productIds = productIds.join(',');
  }
  if (metrics && metrics.length > 0) {
    params.metrics = metrics.join(',');
  }
  return cachedGet('/compare/aggregate', params);
};

export const getCompareTrend = async (startDate, endDate, metric, productIds = null) => {
  const params = { startDate, endDate, metric };
  if (productIds && productIds.length > 0) {
    params.productIds = productIds.join(',');
  }
  return cachedGet('/compare/trend', params);
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
