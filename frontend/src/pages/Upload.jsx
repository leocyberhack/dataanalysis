import { useState } from 'react';
import { UploadCloud, Trash2 } from 'lucide-react';
import { uploadData, uploadOrderData, deleteData } from '../api';
import dayjs from 'dayjs';

const Upload = () => {
    const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));

    // Commodity Data state
    const [comFile, setComFile] = useState(null);
    const [comLoading, setComLoading] = useState(false);
    const [comMessage, setComMessage] = useState('');

    // Order Data state
    const [orderFile, setOrderFile] = useState(null);
    const [orderLoading, setOrderLoading] = useState(false);
    const [orderMessage, setOrderMessage] = useState('');

    const handleUploadCom = async () => {
        if (!date || !comFile) {
            setComMessage('请选择日期和文件');
            return;
        }
        setComLoading(true);
        setComMessage('');
        try {
            await uploadData(date, comFile);
            setComMessage('✅ 商品数据上传成功！');
            setComFile(null);
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
        setOrderLoading(true);
        setOrderMessage('');
        try {
            await uploadOrderData(date, orderFile);
            setOrderMessage('✅ 订单数据上传成功！');
            setOrderFile(null);
        } catch (err) {
            setOrderMessage('❌ 上传失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setOrderLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!date) {
            setComMessage('请先选择日期');
            return;
        }
        if (!window.confirm(`确定要取消绑定并删除 [${date}] 这天的所有商品及订单数据吗？此操作无法撤销。`)) {
            return;
        }
        setComLoading(true);
        setOrderLoading(true);
        setComMessage('');
        setOrderMessage('');
        try {
            const res = await deleteData(date);
            setComMessage(`✅ ${res.message}`);
        } catch (err) {
            setComMessage('❌ 删除失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setComLoading(false);
            setOrderLoading(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">数据上传</h1>
            </div>

            <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                            <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>全局目标日期</h3>
                            <div className="input-group">
                                <input
                                    type="date"
                                    className="input"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                />
                            </div>
                        </div>
                        <div style={{ marginLeft: '24px', paddingTop: '28px' }}>
                            <button
                                className="btn"
                                style={{
                                    justifyContent: 'center',
                                    padding: '12px 20px',
                                    background: 'var(--danger)',
                                    borderColor: 'var(--danger)'
                                }}
                                onClick={handleDelete}
                                disabled={comLoading || orderLoading || !date}
                            >
                                <Trash2 size={18} style={{ marginRight: '6px' }} />
                                解绑当日所有数据
                            </button>
                        </div>
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

                        <button
                            className="btn"
                            style={{ width: '100%', justifyContent: 'center', padding: '12px', marginBottom: '16px' }}
                            onClick={handleUploadCom}
                            disabled={comLoading || !date || !comFile}
                        >
                            {comLoading ? '正在处理数据...' : '上传商品数据'}
                        </button>

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

                        <button
                            className="btn"
                            style={{ width: '100%', justifyContent: 'center', padding: '12px', marginBottom: '16px' }}
                            onClick={handleUploadOrder}
                            disabled={orderLoading || !date || !orderFile}
                        >
                            {orderLoading ? '正在处理数据...' : '上传订单利润数据'}
                        </button>

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
            </div>
        </div>
    );
};

export default Upload;
