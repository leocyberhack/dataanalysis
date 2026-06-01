import { useState } from 'react';
import { CloudDownload, DatabaseBackup, FileArchive, ShieldCheck } from 'lucide-react';
import { downloadCloudDataArchive } from '../api';

const fallbackFilename = () => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `zeabur_cloud_data_${stamp}.zip`;
};

const parseDownloadFilename = (headers = {}) => {
  const disposition = headers['content-disposition'] || headers['Content-Disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallbackFilename();
};

function CloudDataExport() {
  const [downloading, setDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      const response = await downloadCloudDataArchive();
      const filename = parseDownloadFilename(response.headers);
      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setStatusMessage(`已开始下载：${filename}`);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.response?.data?.detail || error.message || '云端数据打包失败，请稍后重试。');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">云端数据下载</h1>
      </div>

      <section className="glass-panel cloud-export-hero mb-32">
        <div className="cloud-export-icon">
          <CloudDownload size={34} />
        </div>
        <div>
          <h2>下载 Zeabur 云端保存的全部数据</h2>
          <p>
            系统会实时把云端数据库、所有核心数据表、POI 配置和已归档的原始上传文件打包成一个 ZIP。
            这样迁移、备份或排查数据时，不需要分别进入服务器手动取文件。
          </p>
        </div>
        <button type="button" className="btn cloud-export-download" onClick={handleDownload} disabled={downloading}>
          <CloudDownload size={18} />
          {downloading ? '正在打包...' : '下载全部数据'}
        </button>
      </section>

      {(statusMessage || errorMessage) && (
        <div className={`cloud-export-status ${errorMessage ? 'is-error' : 'is-success'} mb-24`}>
          {errorMessage || statusMessage}
        </div>
      )}

      <div className="cloud-export-grid mb-32">
        <div className="glass-panel cloud-export-card">
          <DatabaseBackup size={24} />
          <h3>SQLite 数据库备份</h3>
          <p>包含 Zeabur 持久化目录里的当前数据库快照，适合完整迁移或恢复。</p>
        </div>
        <div className="glass-panel cloud-export-card">
          <FileArchive size={24} />
          <h3>全量 CSV 导出</h3>
          <p>商品、每日数据、计划、审核订单、汇总表都会导出成可打开的 CSV 文件。</p>
        </div>
        <div className="glass-panel cloud-export-card">
          <ShieldCheck size={24} />
          <h3>原始上传文件归档</h3>
          <p>从这个版本开始，每次上传成功的 Excel 原件也会归档，并随 ZIP 一起下载。</p>
        </div>
      </div>

      <section className="glass-panel cloud-export-note">
        <h3>说明</h3>
        <p>
          之前版本没有保留历史 Excel 原件，所以历史数据会通过数据库备份和 CSV 导出完整下载；
          此版本上线后的新上传文件，会额外保存在云端归档目录里。
        </p>
      </section>
    </div>
  );
}

export default CloudDataExport;
