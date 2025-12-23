import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'EtherLift',
  projectId: '4f8c2a1c2f4b498982f92b1e19952c70',
  chains: [sepolia],
  ssr: false,
});
