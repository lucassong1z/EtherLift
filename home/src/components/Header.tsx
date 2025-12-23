import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="nav">
      <div className="nav__brand">
        <div className="nav__logo">Ξ</div>
        <div>
          <p className="nav__kicker">Zama-powered cETH</p>
          <h1 className="nav__title">EtherLift</h1>
        </div>
      </div>
      <ConnectButton />
    </header>
  );
}
