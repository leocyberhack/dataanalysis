import { useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { getDateStatus, getDates, getSummary } from '../api';
import SummaryMetricsGrid from '../components/SummaryMetricsGrid';
import { formatDateRangeKeys, parseStoredDate } from '../utils/date';
import { createDateStatusDayRenderer } from '../utils/dateStatusDayRenderer';

registerLocale('zh-CN', zhCN);

const Dashboard = () => {
  const [dates, setDates] = useState([]);
  const [pickerStartDate, setPickerStartDate] = useState(null);
  const [pickerEndDate, setPickerEndDate] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dateStatus, setDateStatus] = useState({});

  const renderDateStatusDay = useMemo(
    () => createDateStatusDayRenderer(dateStatus, { compact: true }),
    [dateStatus],
  );

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [dbDates, status] = await Promise.all([getDates(), getDateStatus()]);
        setDates(dbDates);
        setDateStatus(status);

        if (dbDates.length > 0) {
          const latest = parseStoredDate(dbDates[0]);
          setPickerStartDate(latest);
          setPickerEndDate(latest);
          setStartDate(latest);
          setEndDate(latest);
        }
      } catch (error) {
        console.error(error);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!startDate) {
      return;
    }

    const { startKey, endKey } = formatDateRangeKeys(startDate, endDate);

    const fetchSummary = async () => {
      setLoading(true);
      try {
        const summary = await getSummary(startKey, endKey);
        setData(summary);
      } catch (error) {
        console.error(error);
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [startDate, endDate]);

  const handleDateRangeChange = (update) => {
    const [start, end] = update;
    if (!start) {
      return;
    }
    setPickerStartDate(start);
    setPickerEndDate(end);
    setStartDate(start);
    setEndDate(end || start);
  };

  const getTitlePrefix = () => {
    if (!startDate) {
      return '当日';
    }

    const { startKey, endKey } = formatDateRangeKeys(startDate, endDate);
    return startKey === endKey ? '当日' : '该周期';
  };

  if (!dates.length) {
    return (
      <div className="flex-col" style={{ alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <AlertCircle size={48} color="var(--text-muted)" />
        <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>暂无数据，请先前往数据上传页面导入数据。</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">核心业务指标</h1>
      </div>

      <div className="glass-panel" style={{ marginBottom: '24px', position: 'relative', zIndex: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div className="mobile-tag-row" style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#60A5FA' }} />商品数据
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />利润数据
            </div>
          </div>

          <div className="mobile-date-row" style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center' }}>
            <div className="status-datepicker-wrapper is-dashboard mobile-full-width">
              <DatePicker
                selectsRange
                startDate={pickerStartDate}
                endDate={pickerEndDate}
                onChange={handleDateRangeChange}
                dateFormat="yyyy-MM-dd"
                locale="zh-CN"
                isClearable={false}
                placeholderText="请选择日期或范围"
                showPopperArrow={false}
                renderDayContents={renderDateStatusDay}
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div>加载中...</div>
      ) : data?.today ? (
        <SummaryMetricsGrid summary={data} prefix={getTitlePrefix()} />
      ) : (
        <div>获取数据出错，或当前日期范围内暂无可展示数据。</div>
      )}
    </div>
  );
};

export default Dashboard;
