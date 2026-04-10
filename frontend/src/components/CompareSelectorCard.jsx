import { memo } from 'react';

function CompareSelectorCard({
  title,
  tip,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  selectedCount,
  totalCount,
  filteredCount,
  allSelected,
  filteredValues,
  options,
  selectedValueSet,
  setSelectedValues,
  toggleAllText,
  clearText,
  masterCheckText,
  clearDisabled = false,
  emptyText,
}) {
  const handleToggleOption = (value) => {
    setSelectedValues((previous) => {
      const nextValues = new Set(previous);
      if (nextValues.has(value)) {
        nextValues.delete(value);
      } else {
        nextValues.add(value);
      }
      return Array.from(nextValues);
    });
  };

  const handleToggleAll = () => {
    setSelectedValues((previous) => {
      const nextValues = new Set(previous);

      if (allSelected) {
        filteredValues.forEach((value) => nextValues.delete(value));
      } else {
        filteredValues.forEach((value) => nextValues.add(value));
      }

      return Array.from(nextValues);
    });
  };

  const handleClear = () => {
    setSelectedValues([]);
  };

  return (
    <div className="compare-selector-card">
      <div className="compare-selector-header">
        <div>
          <div className="input-label" style={{ marginBottom: '6px' }}>{title}</div>
          <div className="compare-selector-tip">{tip}</div>
        </div>
        <div className="compare-selector-count">已选 {selectedCount} / {totalCount}</div>
      </div>

      <div className="compare-selector-toolbar">
        <input
          className="compare-selector-search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
        />
        <div className="compare-selector-actions">
          <button type="button" className="compare-selector-action" onClick={handleToggleAll} disabled={filteredCount === 0}>
            {toggleAllText}
          </button>
          <button type="button" className="compare-selector-action" onClick={handleClear} disabled={clearDisabled}>
            {clearText}
          </button>
        </div>
      </div>

      <label className="compare-master-check">
        <input type="checkbox" checked={allSelected} onChange={handleToggleAll} disabled={filteredCount === 0} />
        <span>{masterCheckText}</span>
      </label>

      <div className="compare-checkbox-list">
        {filteredCount === 0 ? (
          <div className="compare-selector-empty">{emptyText}</div>
        ) : (
          options.map((option) => {
            const checked = selectedValueSet.has(option.value);

            return (
              <label className={`compare-checkbox-item ${checked ? 'is-selected' : ''}`} key={option.value}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggleOption(option.value)}
                />
                <span className="compare-checkbox-label" title={option.label}>{option.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

export default memo(CompareSelectorCard);
