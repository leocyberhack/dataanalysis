import { memo, useEffect, useMemo, useRef, useState } from 'react';

const VIRTUAL_OPTION_THRESHOLD = 180;
const VIRTUAL_OPTION_HEIGHT = 42;
const VIRTUAL_OPTION_OVERSCAN = 8;

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
  const listRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const shouldVirtualize = options.length > VIRTUAL_OPTION_THRESHOLD;

  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
      setViewportHeight(listRef.current.clientHeight || 320);
    }
  }, [options]);

  useEffect(() => {
    if (!shouldVirtualize || !listRef.current) {
      return undefined;
    }

    const updateViewportHeight = () => {
      setViewportHeight(listRef.current?.clientHeight || 320);
    };
    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    return () => window.removeEventListener('resize', updateViewportHeight);
  }, [shouldVirtualize]);

  const virtualRange = useMemo(() => {
    if (!shouldVirtualize) {
      return { start: 0, end: options.length };
    }

    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_OPTION_HEIGHT) - VIRTUAL_OPTION_OVERSCAN);
    const visibleCount = Math.ceil(viewportHeight / VIRTUAL_OPTION_HEIGHT) + VIRTUAL_OPTION_OVERSCAN * 2;
    return {
      start,
      end: Math.min(options.length, start + visibleCount),
    };
  }, [options.length, scrollTop, shouldVirtualize, viewportHeight]);

  const visibleOptions = shouldVirtualize
    ? options.slice(virtualRange.start, virtualRange.end)
    : options;

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

  const renderOption = (option, extraStyle = undefined) => {
    const checked = selectedValueSet.has(option.value);

    return (
      <label
        className={`compare-checkbox-item ${checked ? 'is-selected' : ''}`}
        key={option.value}
        style={extraStyle}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => handleToggleOption(option.value)}
        />
        <span className="compare-checkbox-label" title={option.label}>{option.label}</span>
      </label>
    );
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

      <div
        className="compare-checkbox-list"
        ref={listRef}
        onScroll={shouldVirtualize ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
        style={shouldVirtualize ? {
          display: 'block',
          position: 'relative',
          paddingRight: '6px',
        } : undefined}
      >
        {filteredCount === 0 ? (
          <div className="compare-selector-empty">{emptyText}</div>
        ) : shouldVirtualize ? (
          <div style={{ height: `${options.length * VIRTUAL_OPTION_HEIGHT}px`, position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${virtualRange.start * VIRTUAL_OPTION_HEIGHT}px`,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {visibleOptions.map((option) => renderOption(option, {
                height: `${VIRTUAL_OPTION_HEIGHT - 8}px`,
                minHeight: `${VIRTUAL_OPTION_HEIGHT - 8}px`,
                margin: 0,
              }))}
            </div>
          </div>
        ) : (
          visibleOptions.map((option) => renderOption(option))
        )}
      </div>
    </div>
  );
}

export default memo(CompareSelectorCard);
