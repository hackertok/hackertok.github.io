import { useContext } from 'react';
import { NetworkStatusContext } from '../context/networkStatusDef';
import type { NetworkStatusContextValue } from '../context/networkStatusDef';

export function useNetworkStatus(): NetworkStatusContextValue {
  return useContext(NetworkStatusContext);
}
