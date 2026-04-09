import { createContext } from 'react';
import type { ScrollContainerContextValue } from '../types';

export const ScrollContainerContext = createContext<ScrollContainerContextValue | null>(null);
