import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

export const uploadData = async (date, file) => {
  const formData = new FormData();
  formData.append('date', date);
  formData.append('file', file);
  return api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const uploadOrderData = async (date, file) => {
  const formData = new FormData();
  formData.append('date', date);
  formData.append('file', file);
  return api.post('/upload_orders', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const getDates = async () => {
  const res = await api.get('/dates');
  return res.data.dates;
};

export const getProducts = async (startDate, endDate) => {
  const params = {};
  if (startDate && endDate) {
    params.startDate = startDate;
    params.endDate = endDate;
  }
  const res = await api.get('/products', { params });
  return res.data;
};

export const getSummary = async (date) => {
  const res = await api.get('/summary', { params: { date } });
  return res.data;
};

export const getDetailedData = async (startDate, endDate, productIds = null) => {
  const params = { startDate, endDate };
  if (productIds && productIds.length > 0) {
    params.productIds = productIds.join(',');
  }
  const res = await api.get('/data', { params });
  return res.data;
};

export const deleteData = async (date) => {
  const res = await api.delete('/data', { params: { date } });
  return res.data;
};

export const deleteCommodityData = async (date) => {
  const res = await api.delete('/data/commodity', { params: { date } });
  return res.data;
};

export const deleteOrderData = async (date) => {
  const res = await api.delete('/data/order', { params: { date } });
  return res.data;
};
