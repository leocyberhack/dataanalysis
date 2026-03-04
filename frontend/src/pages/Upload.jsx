import { useState } from 'react';
import { UploadCloud, Trash2 } from 'lucide-react';
import { uploadData, deleteData } from '../api';
import dayjs from 'dayjs';

const Upload = () => {
    const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const handleUpload = async () => {
        if (!date || !file) {
            setMessage('请选择日期和文件');
            return;
        }
        setLoading(true);
        setMessage('');
        try {
            await uploadData(date, file);
            setMessage('✅ 数据上传成功！可以前往数据看板查看。');
            setFile(null);
        } catch (err) {
            setMessage('❌ 上传失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!date) {
            setMessage('请先选择日期');
            return;
        }
        if (!window.confirm(`确定要取消绑定并删除 [${date}] 这天的所有商品数据吗？此操作无法撤销。`)) {
            return;
        }
        setLoading(true);
        setMessage('');
        try {
            const res = await deleteData(date);
            setMessage(`✅ ${res.message}`);
        } catch (err) {
            setMessage('❌ 删除失败: ' + (err.response?.data?.detail || err.message));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">数据上传</h1>
            </div>

            <div className="glass-panel" style={{ maxWidth: '600px', margin: '0 auto' }}>
                <p style={{ marginBottom: '20px', color: 'var(--text-muted)' }}>
                    请选择要绑定的日期，并上传对应的美团商品数据 Excel 表格。
                </p>

                <div className="input-group mb-24">
                    <label className="input-label">绑定日期</label>
                    <input
                        type="date"
                        className="input"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>

                <div className="input-group mb-24">
                    <label className="input-label">Excel 数据表</label>
                    <label className={`upload-area ${file ? 'drag-active' : ''}`}>
                        <UploadCloud size={48} className="upload-icon" />
                        <span style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>
                            {file ? file.name : '点击选择或拖拽文件到此处'}
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            支持 .xlsx 格式
                        </span>
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            style={{ display: 'none' }}
                            onChange={(e) => setFile(e.target.files[0])}
                        />
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '16px' }}>
                    <button
                        className="btn"
                        style={{ flex: 1, justifyContent: 'center', padding: '12px' }}
                        onClick={handleUpload}
                        disabled={loading || !date || !file}
                    >
                        {loading ? '正在处理数据...' : '开始上传并解析'}
                    </button>

                    <button
                        className="btn"
                        style={{
                            flex: '0 0 auto',
                            justifyContent: 'center',
                            padding: '12px 20px',
                            background: 'var(--danger)',
                            borderColor: 'var(--danger)'
                        }}
                        onClick={handleDelete}
                        disabled={loading || !date}
                    >
                        <Trash2 size={18} style={{ marginRight: '6px' }} />
                        解绑当日数据
                    </button>
                </div>

                {message && (
                    <div style={{
                        marginTop: '20px',
                        padding: '12px',
                        borderRadius: '8px',
                        background: message.includes('✅') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: message.includes('✅') ? 'var(--success)' : 'var(--danger)',
                        fontSize: '14px',
                        textAlign: 'center'
                    }}>
                        {message}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Upload;
