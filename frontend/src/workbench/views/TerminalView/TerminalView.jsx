import React, { forwardRef } from 'react';
import LegacyTerminalView from '../../panel/views/TerminalView';

export default forwardRef(function TerminalView(props, ref) {
  return <LegacyTerminalView ref={ref} {...props} />;
});

