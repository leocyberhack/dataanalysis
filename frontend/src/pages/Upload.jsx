import { useState, useEffect } from 'react';
import { UploadCloud, Trash2 } from 'lucide-react';
import { uploadData, uploadOrderData, deleteCommodityData, deleteOrderData, getDateStatus } from '../api';
import dayjs from 'dayjs';
import DatePicker, { registerLocale } from 'react-datepicker';
import { zhCN } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
registerLocale('zh-CN', zhCN);

const Upload = () => {
    const [date, setDate] = useState(dayjs().toDate());
    const [dateStatus, setDateStatus] = useState({});

    const refreshDateStatus = () => {
        getDateStatus().then(d => setDateStatus(d)).catch(e => console.error(e));
    };

    useEffect(() => {
        refreshDateStatus();
    }, []);

    // Commodity Data state
    const [comFile, setComFile] = useState(null);
    const [comLoading, setComLoading] = useState(false);
    const [comMessage, setComMessage] = useState('');

    // Order Data state
    const [orderFile, setOrderFile] = useState(null);
    const [orderLoading, setOrderLoading] = useState(false);
    const [orderMessage, setOrderMessage] = useState('');

    // Batch Data state
    const [batchFiles, setBatchFiles] = useState([]);
    const [batchLoading, setBatchLoading] = useState(false);
    const [batchMessage, setBatchMessage] = useState('');

    const handleUploadCom = async () => {
        if (!date || !comFile) {
            setComMessage('请选择日期和文件');
            return;
        }
        const dateStr = dayjs(date).format('YYYY-MM-DD');
        const status = dateStatus[dateStr];
        if (status?.commodity) {
            if (!window.confirm(`[${dateStr}] 已有商品数据，重新上传将覆盖旧的商品数据（利润数据会保留）。确认继续？`)) return;
        }
        setComLoading(true);
        setComMessage('');
        try {
            await uploadData(dateStr, comFile);
            setComMessage('✅ 商品数据上传成功！');
            setComFile(null);
            refreshDateStatus();
        } catch (err) {
            setComMessage('❌ 上传失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setComLoading(false);
        }
    };

    const handleUploadOrder = async () => {
        if (!date || !orderFile) {
            setOrderMessage('请选择日期和文件');
            return;
        }
        const dateStr = dayjs(date).format('YYYY-MM-DD');
        const status = dateStatus[dateStr];
        if (status?.order) {
            if (!window.confirm(`[${dateStr}] 已有订单利润数据，重新上传将全量覆盖旧的利润数据。确认继续？`)) return;
        }
        setOrderLoading(true);
        setOrderMessage('');
        try {
            const res = await uploadOrderData(dateStr, orderFile);
            setOrderMessage(`✅ ${res.data?.message || '订单数据上传成功！'}`);
            setOrderFile(null);
            refreshDateStatus();
        } catch (err) {
            setOrderMessage('❌ 上传失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setOrderLoading(false);
        }
    };

    const handleDeleteCom = async () => {
        if (!date) {
            setComMessage('请先选择日期');
            return;
        }
        const dateStr = dayjs(date).format('YYYY-MM-DD');
        if (!window.confirm(`确定要清空 [${dateStr}] 这天的商品常规数据吗？此操作无法撤销。`)) {
            return;
        }
        setComLoading(true);
        setComMessage('');
        try {
            const res = await deleteCommodityData(dateStr);
            setComMessage(`✅ ${res.message}`);
            refreshDateStatus();
        } catch (err) {
            setComMessage('❌ 删除失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setComLoading(false);
        }
    };

    const handleDeleteOrder = async () => {
        if (!date) {
            setOrderMessage('请先选择日期');
            return;
        }
        const dateStr = dayjs(date).format('YYYY-MM-DD');
        if (!window.confirm(`确定要清空 [${dateStr}] 这天的订单利润数据吗？此操作无法撤销。`)) {
            return;
        }
        setOrderLoading(true);
        setOrderMessage('');
        try {
            const res = await deleteOrderData(dateStr);
            setOrderMessage(`✅ ${res.message}`);
            refreshDateStatus();
        } catch (err) {
            setOrderMessage('❌ 删除失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setOrderLoading(false);
        }
    };

    const parseFileName = (filename) => {
        const base = filename.replace(/\.[^/.]+$/, "");
        const match = base.match(/(商品排行|散客单组).*?(20\d{2})[-_年/]?(\d{1,2})[-_月/]?(\d{1,2})/);
        if (match) {
            const type = match[1] === '商品排行' ? 'commodity' : 'order';
            const year = match[2];
            const month = match[3].padStart(2, '0');
            const day = match[4].padStart(2, '0');
            const date = `${year}-${month}-${day}`;
            return { type, date };
        }
        return null;
    };

    const handleBatchFilesSelect = (e) => {
        const files = Array.from(e.target.files);
        const parsed = files.map(file => {
            const info = parseFileName(file.name);
            return {
                file,
                info,
                status: 'pending'
            };
        });
        setBatchFiles(parsed);
        setBatchMessage('');
    };

    const handleBatchUpload = async () => {
        setBatchLoading(true);
        setBatchMessage('');
        let successCount = 0;
        let failCount = 0;
        const newFiles = [...batchFiles];

        for (let i = 0; i < newFiles.length; i++) {
            const item = newFiles[i];
            if (!item.info) {
                item.status = 'fail';
                item.error = '无法识别文件名与日期';
                failCount++;
                continue;
            }
            try {
                if (item.info.type === 'commodity') {
                    await uploadData(item.info.date, item.file);
                } else {
                    await uploadOrderData(item.info.date, item.file);
                }
                item.status = 'success';
                successCount++;
            } catch (err) {
                item.status = 'fail';
                item.error = err.response?.data?.detail || err.message;
                failCount++;
            }
            setBatchFiles([...newFiles]);
        }

        setBatchLoading(false);
        refreshDateStatus();
        if (failCount === 0 && successCount > 0) {
            setBatchMessage(`✅ 成功批量上传 ${successCount} 个文件！`);
        } else if (successCount > 0) {
            setBatchMessage(`⚠️ 上传完成: ${successCount} 成功, ${failCount} 失败`);
        } else {
            setBatchMessage(`❌ 全部上传失败或存在未识别文件。`);
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">数据上传</h1>
            </div>

            <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <style>
                    {`
                    .custom-datepicker-wrapper .react-datepicker-wrapper {
                        width: 100%;
                    }
                    .custom-datepicker-wrapper .react-datepicker {
                        font-family: inherit;
                        border: 1px solid var(--glass-border);
                        border-radius: 16px;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                        padding: 16px;
                        font-size: 1.2rem;
                    }
                    .custom-datepicker-wrapper .react-datepicker__current-month {
                        font-size: 1.5em;
                        padding-bottom: 8px;
                    }
                    .custom-datepicker-wrapper .react-datepicker__navigation {
                        top: 20px;
                    }
                    .custom-datepicker-wrapper .react-datepicker__navigation-icon::before {
                        border-width: 3px 3px 0 0;
                        height: 12px;
                        width: 12px;
                    }
                    .custom-datepicker-wrapper .react-datepicker__day-name, 
                    .custom-datepicker-wrapper .react-datepicker__day, 
                    .custom-datepicker-wrapper .react-datepicker__time-name {
                        width: 4.5rem;
                        line-height: 4.5rem;
                        margin: 0.2rem;
                    }
                    .custom-datepicker-wrapper .react-datepicker__input-container input {
                        width: 100%;
                        background: var(--bg-light);
                        border: 1px solid var(--glass-border);
                        border-radius: 8px;
                        padding: 12px 16px;
                        font-family: inherit;
                        font-size: 15px;
                        color: var(--text-main);
                        outline: none;
                        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                        cursor: pointer;
                    }
                    .custom-datepicker-wrapper .react-datepicker__input-container input:hover {
                        border-color: rgba(224, 122, 95, 0.4);
                        background: rgba(255, 255, 255, 0.9);
                    }
                    .custom-datepicker-wrapper .react-datepicker__input-container input:focus {
                        border-color: var(--accent);
                        box-shadow: 0 0 0 3px rgba(224, 122, 95, 0.15);
                        background: #ffffff;
                    }
                    `}
                </style>
                <div className="glass-panel" style={{ padding: '24px', position: 'relative', zIndex: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div>
                            <h3 style={{ fontSize: '18px', fontWeight: '600' }}>全局目标日期</h3>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '14px', color: 'var(--text-muted)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#60A5FA' }} /> 商品数据
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#F59E0B' }} /> 利润数据
                            </div>
                        </div>
                    </div>

                    <div className="input-group custom-datepicker-wrapper" style={{ position: 'relative', zIndex: 1000 }}>
                        <DatePicker
                            selected={date}
                            onChange={(d) => setDate(d)}
                            dateFormat="yyyy-MM-dd"
                            locale="zh-CN"
                            className="input"
                            isClearable={false}
                            renderDayContents={(day, dateObj) => {
                                const dateStr = dayjs(dateObj).format('YYYY-MM-DD');
                                const status = dateStatus[dateStr];
                                return (
                                    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{ lineHeight: '1.2' }}>{day}</span>
                                        <div style={{ position: 'absolute', bottom: '4px', display: 'flex', gap: '6px', justifyContent: 'center', width: '100%' }}>
                                            {status?.commodity && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#60A5FA' }} title="已上传商品数据" />}
                                            {status?.order && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} title="已上传利润数据" />}
                                        </div>
                                    </div>
                                );
                            }}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                    {/* Commodity File Upload */}
                    <div className="glass-panel" style={{ flex: '1 1 300px' }}>
                        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>1. 商品数据上传</h3>
                        <p style={{ marginBottom: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>
                            上传包含支付、核销等各类业务指标的商品数据表。
                        </p>

                        <div className="input-group mb-24">
                            <label className={`upload-area ${comFile ? 'drag-active' : ''}`}>
                                <UploadCloud size={48} className="upload-icon" />
                                <span style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>
                                    {comFile ? comFile.name : '点击选择或拖拽文件到此处'}
                                </span>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    支持 .xlsx 格式
                                </span>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    style={{ display: 'none' }}
                                    onChange={(e) => setComFile(e.target.files[0])}
                                />
                            </label>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                            <button
                                className="btn"
                                style={{ flex: 1, justifyContent: 'center', padding: '12px' }}
                                onClick={handleUploadCom}
                                disabled={comLoading || !date || !comFile}
                            >
                                {comLoading ? '正在处理数据...' : '上传商品数据'}
                            </button>
                            <button
                                className="btn"
                                style={{ flex: '0 0 auto', justifyContent: 'center', padding: '12px 16px', background: 'transparent', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                                onClick={handleDeleteCom}
                                disabled={comLoading || !date}
                            >
                                <Trash2 size={18} style={{ marginRight: '6px' }} />
                                清空
                            </button>
                        </div>

                        {comMessage && (
                            <div style={{
                                padding: '12px', borderRadius: '8px', fontSize: '14px', textAlign: 'center',
                                background: comMessage.includes('✅') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                color: comMessage.includes('✅') ? 'var(--success)' : 'var(--danger)',
                            }}>
                                {comMessage}
                            </div>
                        )}
                    </div>

                    {/* Order File Upload */}
                    <div className="glass-panel" style={{ flex: '1 1 300px' }}>
                        <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>2. 订单(利润)数据上传</h3>
                        <p style={{ marginBottom: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>
                            上传【散客单组】表以解析计算单日各旅游线路的利润数据。
                        </p>

                        <div className="input-group mb-24">
                            <label className={`upload-area ${orderFile ? 'drag-active' : ''}`}>
                                <UploadCloud size={48} className="upload-icon" />
                                <span style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>
                                    {orderFile ? orderFile.name : '点击选择或拖拽文件到此处'}
                                </span>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    支持 .xls 格式
                                </span>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    style={{ display: 'none' }}
                                    onChange={(e) => setOrderFile(e.target.files[0])}
                                />
                            </label>
                        </div>

                        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                            <button
                                className="btn"
                                style={{ flex: 1, justifyContent: 'center', padding: '12px' }}
                                onClick={handleUploadOrder}
                                disabled={orderLoading || !date || !orderFile}
                            >
                                {orderLoading ? '正在处理数据...' : '上传订单利润数据'}
                            </button>
                            <button
                                className="btn"
                                style={{ flex: '0 0 auto', justifyContent: 'center', padding: '12px 16px', background: 'transparent', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                                onClick={handleDeleteOrder}
                                disabled={orderLoading || !date}
                            >
                                <Trash2 size={18} style={{ marginRight: '6px' }} />
                                清空
                            </button>
                        </div>

                        {orderMessage && (
                            <div style={{
                                padding: '12px', borderRadius: '8px', fontSize: '14px', textAlign: 'center',
                                background: orderMessage.includes('✅') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                color: orderMessage.includes('✅') ? 'var(--success)' : 'var(--danger)',
                            }}>
                                {orderMessage}
                            </div>
                        )}
                    </div>
                </div>

                {/* Batch Upload Option */}
                <div className="glass-panel" style={{ marginTop: '0px' }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>3. 批量智能上传 (自动识别日期和类型)</h3>
                    <p style={{ marginBottom: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>
                        一次性选择多个 Excel 文件（通过文件名识别）。请保证文件命名规则包含关键词与日期，支持 <b>商品排行yyyy/mm/dd</b> 或 <b>散客单组yyyy/mm/dd</b>（符号可以为-、_或无符号）。
                    </p>

                    <div className="input-group mb-24">
                        <label className={`upload-area ${batchFiles.length > 0 ? 'drag-active' : ''}`}>
                            <UploadCloud size={48} className="upload-icon" />
                            <span style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>
                                {batchFiles.length > 0 ? `已选择 ${batchFiles.length} 个文件` : '点击选择或拖拽多个文件到此处'}
                            </span>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                支持同时上传多天、多类型的表格
                            </span>
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleBatchFilesSelect}
                            />
                        </label>
                    </div>

                    {batchFiles.length > 0 && (
                        <div style={{ marginBottom: '24px', maxHeight: '200px', overflowY: 'auto', background: 'rgba(255,255,255,0.4)', borderRadius: '8px', padding: '12px', border: '1px solid var(--glass-border)' }}>
                            {batchFiles.map((item, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: idx === batchFiles.length - 1 ? 'none' : '1px solid var(--glass-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span style={{ fontWeight: 500, fontSize: '14px' }}>{item.file.name}</span>
                                        {item.info ? (
                                            <span style={{ fontSize: '12px', padding: '2px 8px', background: 'var(--accent)', color: 'white', borderRadius: '4px' }}>
                                                {item.info.date} | {item.info.type === 'commodity' ? '商品数据' : '利润数据'}
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: '12px', padding: '2px 8px', background: 'var(--danger)', color: 'white', borderRadius: '4px' }}>
                                                未识别时间格式
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '14px' }}>
                                        {item.status === 'success' && <span style={{ color: 'var(--success)' }}>✅ 成功</span>}
                                        {item.status === 'fail' && <span style={{ color: 'var(--danger)' }}>❌ {item.error}</span>}
                                        {item.status === 'pending' && <span style={{ color: 'var(--text-muted)' }}>待上传</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <button
                        className="btn"
                        style={{ width: '100%', justifyContent: 'center', padding: '12px', marginBottom: '16px' }}
                        onClick={handleBatchUpload}
                        disabled={batchLoading || batchFiles.length === 0}
                    >
                        {batchLoading ? '正在批量处理数据...' : '开始批量上传'}
                    </button>

                    {batchMessage && (
                        <div style={{
                            padding: '12px', borderRadius: '8px', fontSize: '14px', textAlign: 'center',
                            background: batchMessage.includes('❌') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                            color: batchMessage.includes('❌') ? 'var(--danger)' : 'var(--success)',
                        }}>
                            {batchMessage}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Upload;
