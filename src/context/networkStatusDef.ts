import { createContext } from 'react';

export interface NetworkStatusContextValue {
  isOnline: boolean;
}

export const NetworkStatusContext = createContext<NetworkStatusContextValue>({ isOnline: true });
