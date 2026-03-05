import { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { ArrowUpRight, ArrowDownRight, Minus, AlertCircle } from 'lucide-react';
import dayjs from 'dayjs';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { getDates, getSummary, getDetailedData, getDateStatus } from '../api';

const Dashboard = () => {
    const [dates, setDates] = useState([]);
    const [dateRange, setDateRange] = useState([null, null]);
    const [confirmedRange, setConfirmedRange] = useState([null, null]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [dateStatus, setDateStatus] = useState({});

    useEffect(() => {
        fetchDates();
        getDateStatus().then(d => setDateStatus(d)).catch(console.error);
    }, []);

    useEffect(() => {
        if (confirmedRange[0]) {
            const startStr = dayjs(confirmedRange[0]).format('YYYY-MM-DD');
            const endStr = confirmedRange[1] ? dayjs(confirmedRange[1]).format('YYYY-MM-DD') : startStr;
            fetchSummary(startStr, endStr);
        }
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
        } catch (e) {
            console.error(e);
        }
    };

    const fetchSummary = async (startDate, endDate) => {
        setLoading(true);
        try {
            const summary = await getSummary(startDate, endDate);
            setData(summary);
        } catch (e) {
            console.error(e);
            setData(null);
        } finally {
            setLoading(false);
        }
    };

    if (!dates.length) {
        return (
            <div className="flex-col" style={{ alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <AlertCircle size={48} color="var(--text-muted)" />
                <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>暂无数据，请先前往数据上传页面导入数据。</p>
            </div>
        );
    }

    const renderMetric = (title, key, valueFormatter) => {
        if (!data || !data.today) return null;
        const value = data.today[key];
        const change = data.changes ? data.changes[key] : null;
        const hasYest = data.has_yesterday;

        return (
            <div className="glass-panel metric-card" key={key}>
                <div className="metric-title">{title}</div>
                <div className="metric-value">{valueFormatter(value)}</div>
                <div className="metric-change">
                    {!hasYest ? (
                        <span className="change-neutral">上一期数据未上传</span>
                    ) : change === null || change === undefined ? (
                        <span className="change-neutral"><Minus size={14} /> 0.00%</span>
                    ) : change > 0 ? (
                        <span className="change-up"><ArrowUpRight size={14} /> +{change.toFixed(2)}%</span>
                    ) : change < 0 ? (
                        <span className="change-down"><ArrowDownRight size={14} /> {change.toFixed(2)}%</span>
                    ) : (
                        <span className="change-neutral"><Minus size={14} /> 0.00%</span>
                    )}
                </div>
            </div>
        );
    };

    const fmtCurrency = (v) => `¥${(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtNumber = (v) => `${(v || 0).toLocaleString()}`;
    const fmtPercent = (v) => `${(v || 0).toFixed(2)}%`;

    const handleDateRangeChange = (update) => {
        setDateRange(update);
    };

    const handleConfirmDate = () => {
        const [start, end] = dateRange;
        if (start && end) {
            setConfirmedRange([start, end]);
        } else if (start) {
            setConfirmedRange([start, start]);
        }
    };

    const renderTitlePrefix = () => {
        if (!confirmedRange[0]) return "当日";
        const startStr = dayjs(confirmedRange[0]).format('YYYY-MM-DD');
        const endStr = confirmedRange[1] ? dayjs(confirmedRange[1]).format('YYYY-MM-DD') : startStr;
        if (startStr === endStr) return "当日";
        return "该周期";
    };

    const prefix = renderTitlePrefix();

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="page-title" style={{ margin: 0 }}>核心业务指标</h1>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <style>
                        {`
                        .dashboard-datepicker-wrapper .react-datepicker-wrapper {
                            width: 260px;
                        }
                        .dashboard-datepicker-wrapper .react-datepicker {
                            font-family: inherit;
                            border: 1px solid var(--glass-border);
                            border-radius: 12px;
                            box-shadow: 0 4px 20px rgba(0,0,0,0.05);
                            padding: 8px;
                        }
                        .dashboard-datepicker-wrapper .react-datepicker__month-container {
                            width: 320px;
                        }
                        .dashboard-datepicker-wrapper .react-datepicker__day-name, 
                        .dashboard-datepicker-wrapper .react-datepicker__day, 
                        .dashboard-datepicker-wrapper .react-datepicker__time-name {
                            width: 2.5rem;
                            line-height: 2.5rem;
                            margin: 0.166rem;
                        }
                        .dashboard-datepicker-wrapper .react-datepicker__input-container input {
                            width: 100%;
                            background: rgba(255, 255, 255, 0.9);
                            border: 1px solid var(--glass-border);
                            border-radius: 8px;
                            padding: 8px 12px;
                            font-family: inherit;
                            font-size: 14px;
                            color: var(--text-main);
                            outline: none;
                            transition: all 0.2s;
                            cursor: pointer;
                            text-align: center;
                        }
                        .dashboard-datepicker-wrapper .react-datepicker__input-container input:hover {
                            border-color: rgba(224, 122, 95, 0.4);
                        }
                        .dashboard-datepicker-wrapper .react-datepicker__input-container input:focus {
                            border-color: var(--accent);
                            box-shadow: 0 0 0 2px rgba(224, 122, 95, 0.15);
                        }
                        `}
                    </style>
                    <div className="dashboard-datepicker-wrapper">
                        <DatePicker
                            selectsRange={true}
                            startDate={dateRange[0]}
                            endDate={dateRange[1]}
                            onChange={handleDateRangeChange}
                            dateFormat="yyyy-MM-dd"
                            isClearable={false}
                            placeholderText="请选择日期或范围"
                            showPopperArrow={false}
                            renderDayContents={(day, dateObj) => {
                                const dateStr = dayjs(dateObj).format('YYYY-MM-DD');
                                const status = dateStatus[dateStr];
                                return (
                                    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{ lineHeight: '1.2' }}>{day}</span>
                                        <div style={{ position: 'absolute', bottom: '2px', display: 'flex', gap: '3px', justifyContent: 'center', width: '100%' }}>
                                            {status?.commodity && <div style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#60A5FA' }} title="已上传商品数据" />}
                                            {status?.order && <div style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#F59E0B' }} title="已上传利润数据" />}
                                        </div>
                                    </div>
                                );
                            }}
                        />
                    </div>
                    <button
                        className="btn"
                        style={{ padding: '8px 16px', fontSize: '13px' }}
                        onClick={handleConfirmDate}
                        disabled={!dateRange[0]}
                    >
                        确认
                    </button>
                </div>
            </div>

            {loading ? (
                <div>加载中...</div>
            ) : data?.today ? (
                <>
                    <div className="metrics-grid">
                        {renderMetric(`${prefix}总利润`, 'profit', fmtCurrency)}
                        {renderMetric('利润率', 'profit_margin', fmtPercent)}
                        {renderMetric(`${prefix}总支付金额`, 'pay_amount', fmtCurrency)}
                        {renderMetric('支付订单数', 'pay_orders', fmtNumber)}
                    </div>
                    <div className="metrics-grid" style={{ marginBottom: '24px' }}>
                        {renderMetric('总核销金额', 'redeem_amount', fmtCurrency)}
                        {renderMetric('核销率 (金额)', 'redeem_rate_amount', fmtPercent)}
                        {renderMetric('核销件数', 'redeem_items', fmtNumber)}
                        {renderMetric('核销率 (件数)', 'redeem_rate_item', fmtPercent)}
                    </div>
                    <div className="metrics-grid" style={{ marginBottom: '40px' }}>
                        {renderMetric('店播退款金额', 'live_refund_amount', fmtCurrency)}
                        {renderMetric('店播退款率', 'live_refund_rate', fmtPercent)}
                    </div>
                </>
            ) : (
                <div>获取数据出错或当日无数据结构。</div>
            )}
        </div>
    );
};

export default Dashboard;
