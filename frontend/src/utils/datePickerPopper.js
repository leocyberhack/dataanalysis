import { shift, size } from '@floating-ui/react';

const MIN_POPPER_HEIGHT = 220;
const VIEWPORT_PADDING = 12;

export const datePickerPopperProps = {
  calendarClassName: 'status-datepicker-calendar',
  popperClassName: 'status-datepicker-popper',
  portalId: 'date-picker-portal-root',
  popperProps: {
    strategy: 'fixed',
  },
  popperModifiers: [
    shift({
      padding: VIEWPORT_PADDING,
      crossAxis: true,
    }),
    size({
      padding: VIEWPORT_PADDING,
      apply({ availableHeight, elements }) {
        const maxHeight = Math.max(
          MIN_POPPER_HEIGHT,
          Math.floor(availableHeight),
        );

        Object.assign(elements.floating.style, {
          maxHeight: `${maxHeight}px`,
          overflowY: 'auto',
        });
      },
    }),
  ],
};
