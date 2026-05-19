import { Trophy } from 'lucide-react';

const RANKING_SECTIONS = [
  {
    key: 'pay_amount_products',
    title: '支付金额 Top 5 商品',
    emptyText: '暂无商品支付金额数据',
  },
  {
    key: 'pay_amount_pois',
    title: '支付金额 Top 5 POI',
    emptyText: '暂无 POI 支付金额数据',
  },
  {
    key: 'refund_amount_products',
    title: '退款 Top 5 商品',
    emptyText: '暂无商品退款数据',
  },
];

const formatCurrency = (value) => `¥${Number(value || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

function SummaryRankings({ rankings }) {
  if (!rankings) {
    return null;
  }

  return (
    <div className="summary-ranking-grid">
      {RANKING_SECTIONS.map((section) => {
        const rows = Array.isArray(rankings[section.key]) ? rankings[section.key] : [];

        return (
          <section className="glass-panel summary-ranking-card" key={section.key}>
            <div className="summary-ranking-header">
              <Trophy size={18} color="var(--accent)" />
              <h3>{section.title}</h3>
            </div>

            {rows.length > 0 ? (
              <div className="summary-ranking-list">
                {rows.map((item) => (
                  <div className="summary-ranking-row" key={`${section.key}-${item.id}`}>
                    <div className="summary-ranking-main">
                      <span className={`summary-ranking-rank ${item.rank <= 3 ? 'is-top' : ''}`}>
                        {item.rank}
                      </span>
                      <span className="summary-ranking-name" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <span className="summary-ranking-value">{formatCurrency(item.value)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="summary-ranking-empty">{section.emptyText}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default SummaryRankings;
