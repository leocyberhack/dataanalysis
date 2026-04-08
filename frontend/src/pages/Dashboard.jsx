import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import dayjs from 'dayjs';
import DatePicker, { registerLocale } from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { getDateStatus, getDates, getSummary } from '../api';
import SummaryMetricsGrid from '../components/SummaryMetricsGrid';

registerLocale('zh-CN', zhCN);

const Dashboard = () => {
  const [dates, setDates] = useState([]);
  const [dateRange, setDateRange] = useState([null, null]);
  const [confirmedRange, setConfirmedRange] = useState([null, null]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dateStatus, setDateStatus] = useState({});

  useEffect(() => {
    fetchDates();
    getDateStatus().then(setDateStatus).catch(console.error);
  }, []);

  useEffect(() => {
    if (!confirmedRange[0]) {
      return;
    }

    const startStr = dayjs(confirmedRange[0]).format('YYYY-MM-DD');
    const endStr = confirmedRange[1] ? dayjs(confirmedRange[1]).format('YYYY-MM-DD') : startStr;
    fetchSummary(startStr, endStr);
  }, [confirmedRange]);

  const fetchDates = async () => {
    try {
      const dbDates = await getDates();
      setDates(dbDates);
      if (dbDates.length > 0) {
        const latest = dayjs(dbDates[0]).toDate();
        setDateRange([latest, latest]);
        setConfirmedRange([latest, latest]);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const fetchSummary = async (startDate, endDate) => {
    setLoading(true);
    try {
      const summary = await getSummary(startDate, endDate);
      setData(summary);
    } catch (error) {
      console.error(error);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDateRangeChange = (update) => {
    setDateRange(update);
  };

  const handleConfirmDate = () => {
    const [start, end] = dateRange;
    if (start && end) {
      setConfirmedRange([start, end]);
      return;
    }
    if (start) {
      setConfirmedRange([start, start]);
    }
  };

  const getTitlePrefix = () => {
    if (!confirmedRange[0]) {
      return '当日';
    }
    const startStr = dayjs(confirmedRange[0]).format('YYYY-MM-DD');
    const endStr = confirmedRange[1] ? dayjs(confirmedRange[1]).format('YYYY-MM-DD') : startStr;
    return startStr === endStr ? '当日' : '该周期';
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
        <style>{`
          .dashboard-datepicker-wrapper .react-datepicker-wrapper { width: 300px; }
          .dashboard-datepicker-wrapper .react-datepicker {
            font-family: inherit;
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            padding: 16px;
            font-size: 1.2rem;
          }
          .dashboard-datepicker-wrapper .react-datepicker__current-month { font-size: 1.5em; padding-bottom: 8px; }
          .dashboard-datepicker-wrapper .react-datepicker__navigation { top: 20px; }
          .dashboard-datepicker-wrapper .react-datepicker__navigation-icon::before { border-width: 3px 3px 0 0; height: 12px; width: 12px; }
          .dashboard-datepicker-wrapper .react-datepicker__day-name,
          .dashboard-datepicker-wrapper .react-datepicker__day,
          .dashboard-datepicker-wrapper .react-datepicker__time-name { width: 4rem; line-height: 4rem; margin: 0.2rem; }
          .dashboard-datepicker-wrapper .react-datepicker__input-container input {
            width: 100%;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid var(--glass-border);
            border-radius: 8px;
            padding: 8px 14px;
            font-family: inherit;
            font-size: 15px;
            color: var(--text-main);
            outline: none;
            transition: all 0.2s;
            cursor: pointer;
            text-align: center;
          }
          .dashboard-datepicker-wrapper .react-datepicker__input-container input:hover { border-color: rgba(224, 122, 95, 0.4); }
          .dashboard-datepicker-wrapper .react-datepicker__input-container input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(224, 122, 95, 0.15); }
        `}</style>

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
            <div className="dashboard-datepicker-wrapper mobile-full-width">
              <DatePicker
                selectsRange
                startDate={dateRange[0]}
                endDate={dateRange[1]}
                onChange={handleDateRangeChange}
                dateFormat="yyyy-MM-dd"
                locale="zh-CN"
                isClearable={false}
                placeholderText="请选择日期或范围"
                showPopperArrow={false}
                renderDayContents={(day, dateObj) => {
                  const dateStr = dayjs(dateObj).format('YYYY-MM-DD');
                  const status = dateStatus[dateStr];
                  return (
                    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ lineHeight: '1.2' }}>{day}</span>
                      <div style={{ position: 'absolute', bottom: '4px', display: 'flex', gap: '5px', justifyContent: 'center', width: '100%' }}>
                        {status?.commodity && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#60A5FA' }} title="已上传商品数据" />}
                        {status?.order && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} title="已上传利润数据" />}
                      </div>
                    </div>
                  );
                }}
              />
            </div>
            <button
              className="btn"
              style={{ padding: '8px 20px', fontSize: '14px', flexShrink: 0 }}
              onClick={handleConfirmDate}
              disabled={!dateRange[0]}
            >
              确认
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div>加载中...</div>
      ) : data?.today ? (
        <SummaryMetricsGrid summary={data} prefix={getTitlePrefix()} />
      ) : (
        <div>获取数据出错或当前日期范围内暂无可展示数据。</div>
      )}
    </div>
  );
};

export default Dashboard;
