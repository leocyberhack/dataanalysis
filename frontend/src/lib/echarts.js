import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

const CANVAS_POINT_THRESHOLD = 600;

echarts.use([
  BarChart,
  CanvasRenderer,
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  SVGRenderer,
  TitleComponent,
  TooltipComponent,
]);

const getChartPointCount = (seriesCount = 0, pointCount = 0) => seriesCount * pointCount;

const getRendererForPointCount = (seriesCount = 0, pointCount = 0) => (
  getChartPointCount(seriesCount, pointCount) > CANVAS_POINT_THRESHOLD ? 'canvas' : 'svg'
);

const getLargeLineSeriesOptions = (seriesCount = 0, pointCount = 0, symbolSize = 7) => {
  const isLarge = getChartPointCount(seriesCount, pointCount) > CANVAS_POINT_THRESHOLD;
  return isLarge
    ? {
      animation: false,
      sampling: 'lttb',
      showSymbol: false,
      symbol: 'none',
    }
    : {
      symbolSize,
    };
};

export { echarts, getLargeLineSeriesOptions, getRendererForPointCount };
