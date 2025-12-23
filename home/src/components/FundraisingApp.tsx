import { useEffect, useMemo, useState } from 'react';
import { Contract } from 'ethers';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits, isAddress, parseUnits } from 'viem';

import { CETH_ABI, CETH_ADDRESS, CETH_DECIMALS, FUNDRAISER_ABI, FUNDRAISER_ADDRESS } from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { Header } from './Header';
import '../styles/fundraising.css';

type StatusTone = 'success' | 'error' | 'info';

const ZERO_HANDLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

const formatAmount = (value?: string | bigint | number | null) => {
  if (value === undefined || value === null) return '0';
  const asBigInt = typeof value === 'bigint' ? value : BigInt(value);
  const asNumber = Number(formatUnits(asBigInt, CETH_DECIMALS));
  return asNumber.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

const toDateInput = (timestamp?: number) => {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toISOString().slice(0, 16);
};

export function FundraisingApp() {
  const { address } = useAccount();
  const signer = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [status, setStatus] = useState<{ message: string; tone: StatusTone } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [contributionAmount, setContributionAmount] = useState('1.25');
  const [mintAmount, setMintAmount] = useState('250');
  const [decryptedContribution, setDecryptedContribution] = useState<string | null>(null);
  const [decryptedTotal, setDecryptedTotal] = useState<string | null>(null);
  const [formName, setFormName] = useState('EtherLift Seed');
  const [formTarget, setFormTarget] = useState('100');
  const [formEnd, setFormEnd] = useState('');

  const contractsReady = useMemo(
    () => isAddress(FUNDRAISER_ADDRESS) && isAddress(CETH_ADDRESS),
    [],
  );

  const campaignQuery = useReadContract({
    address: FUNDRAISER_ADDRESS,
    abi: FUNDRAISER_ABI,
    functionName: 'getCampaign',
    query: { enabled: contractsReady },
  });

  const fundraiserQuery = useReadContract({
    address: FUNDRAISER_ADDRESS,
    abi: FUNDRAISER_ABI,
    functionName: 'fundraiser',
    query: { enabled: contractsReady },
  });

  const timeRemainingQuery = useReadContract({
    address: FUNDRAISER_ADDRESS,
    abi: FUNDRAISER_ABI,
    functionName: 'timeRemaining',
    query: { enabled: contractsReady },
  });

  const totalRaisedQuery = useReadContract({
    address: FUNDRAISER_ADDRESS,
    abi: FUNDRAISER_ABI,
    functionName: 'totalRaised',
    query: { enabled: contractsReady },
  });

  const contributionQuery = useReadContract({
    address: FUNDRAISER_ADDRESS,
    abi: FUNDRAISER_ABI,
    functionName: 'contributionOf',
    args: address ? [address] : undefined,
    query: { enabled: contractsReady && Boolean(address) },
  });

  const operatorQuery = useReadContract({
    address: CETH_ADDRESS,
    abi: CETH_ABI,
    functionName: 'isOperator',
    args: address ? [address, FUNDRAISER_ADDRESS] : undefined,
    query: { enabled: contractsReady && Boolean(address) },
  });

  useEffect(() => {
    if (campaignQuery.data) {
      setFormName(campaignQuery.data[0] as string);
      setFormTarget(formatUnits(BigInt(campaignQuery.data[1]), CETH_DECIMALS));
      setFormEnd(toDateInput(Number(campaignQuery.data[2])));
    }
  }, [campaignQuery.data]);

  const isFundraiserOwner =
    address &&
    fundraiserQuery.data &&
    address.toLowerCase() === (fundraiserQuery.data as string).toLowerCase();

  const campaignStatus = useMemo(() => {
    if (!campaignQuery.data) return 'Loading...';
    if (campaignQuery.data[3]) return 'Closed';
    const remaining = timeRemainingQuery.data ? Number(timeRemainingQuery.data) : 0;
    if (remaining <= 0) return 'Awaiting close';
    return 'Active';
  }, [campaignQuery.data, timeRemainingQuery.data]);

  const setMessage = (message: string, tone: StatusTone) => {
    setStatus({ message, tone });
    setTimeout(() => setStatus(null), 6000);
  };

  const getFundraiserContract = async () => {
    const resolvedSigner = await signer;
    if (!resolvedSigner) {
      throw new Error('Connect your wallet first.');
    }
    return new Contract(FUNDRAISER_ADDRESS, FUNDRAISER_ABI, resolvedSigner);
  };

  const getTokenContract = async () => {
    const resolvedSigner = await signer;
    if (!resolvedSigner) {
      throw new Error('Connect your wallet first.');
    }
    return new Contract(CETH_ADDRESS, CETH_ABI, resolvedSigner);
  };

  const approveOperator = async () => {
    try {
      setBusy('operator');
      const contract = await getTokenContract();
      const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const tx = await contract.setOperator(FUNDRAISER_ADDRESS, expiry);
      await tx.wait();
      setMessage('Operator approval granted for the fundraiser.', 'success');
      operatorQuery.refetch();
    } catch (err) {
      setMessage(`Operator approval failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const mintCeth = async () => {
    try {
      const parsed = parseUnits(mintAmount || '0', CETH_DECIMALS);
      if (parsed <= 0) {
        setMessage('Enter a mint amount above zero.', 'error');
        return;
      }
      setBusy('mint');
      const contract = await getTokenContract();
      const tx = await contract.mint(address, parsed);
      await tx.wait();
      setMessage('cETH minted to your wallet.', 'success');
    } catch (err) {
      setMessage(`Mint failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const contribute = async () => {
    try {
      if (!instance) {
        setMessage('Encryption service is not ready yet.', 'error');
        return;
      }
      const parsed = parseUnits(contributionAmount || '0', CETH_DECIMALS);
      if (parsed <= 0) {
        setMessage('Contribution must be above zero.', 'error');
        return;
      }
      setBusy('contribute');
      const encrypted = await instance
        .createEncryptedInput(CETH_ADDRESS, FUNDRAISER_ADDRESS)
        .add64(parsed)
        .encrypt();

      const contract = await getFundraiserContract();
      const tx = await contract.contribute(encrypted.handles[0], encrypted.inputProof);
      await tx.wait();
      setMessage('Contribution submitted.', 'success');
      await Promise.all([totalRaisedQuery.refetch(), contributionQuery.refetch()]);
    } catch (err) {
      setMessage(`Contribution failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const decryptValues = async () => {
    try {
      if (!instance) {
        setMessage('Encryption service is not ready yet.', 'error');
        return;
      }
      if (!address) {
        setMessage('Connect your wallet to decrypt.', 'error');
        return;
      }
      const resolvedSigner = await signer;
      if (!resolvedSigner) {
        setMessage('Connect your wallet to decrypt.', 'error');
        return;
      }

      const handles: Array<{ handle: string; contractAddress: string }> = [];
      if (contributionQuery.data && contributionQuery.data !== ZERO_HANDLE) {
        handles.push({ handle: contributionQuery.data as string, contractAddress: FUNDRAISER_ADDRESS });
      }
      if (totalRaisedQuery.data && totalRaisedQuery.data !== ZERO_HANDLE) {
        handles.push({ handle: totalRaisedQuery.data as string, contractAddress: FUNDRAISER_ADDRESS });
      }
      if (handles.length === 0) {
        setMessage('Nothing to decrypt yet.', 'info');
        return;
      }

      setBusy('decrypt');
      const keypair = instance.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '7';
      const eip712 = instance.createEIP712(keypair.publicKey, [FUNDRAISER_ADDRESS], startTimestamp, durationDays);
      const signature = await resolvedSigner.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const results = await instance.userDecrypt(
        handles,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        [FUNDRAISER_ADDRESS],
        address,
        startTimestamp,
        durationDays
      );

      if (contributionQuery.data && results[contributionQuery.data as string] !== undefined) {
        setDecryptedContribution(formatUnits(BigInt(results[contributionQuery.data as string]), CETH_DECIMALS));
      }
      if (totalRaisedQuery.data && results[totalRaisedQuery.data as string] !== undefined) {
        setDecryptedTotal(formatUnits(BigInt(results[totalRaisedQuery.data as string]), CETH_DECIMALS));
      }

      setMessage('Decryption complete.', 'success');
    } catch (err) {
      setMessage(`Decryption failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const updateCampaign = async () => {
    try {
      const resolvedSigner = await signer;
      if (!resolvedSigner) {
        setMessage('Connect your wallet.', 'error');
        return;
      }
      const parsedTarget = parseUnits(formTarget || '0', CETH_DECIMALS);
      const parsedEnd = Math.floor(new Date(formEnd).getTime() / 1000);
      if (!formName.trim() || parsedTarget <= 0 || !Number.isFinite(parsedEnd)) {
        setMessage('Fill all campaign fields with valid values.', 'error');
        return;
      }
      setBusy('campaign');
      const contract = await getFundraiserContract();
      const tx = await contract.configureCampaign(formName.trim(), parsedTarget, parsedEnd);
      await tx.wait();
      setMessage('Campaign updated.', 'success');
      await campaignQuery.refetch();
    } catch (err) {
      setMessage(`Update failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const closeCampaign = async () => {
    try {
      setBusy('close');
      const contract = await getFundraiserContract();
      const tx = await contract.closeCampaign();
      await tx.wait();
      setMessage('Campaign closed and funds released.', 'success');
      await Promise.all([campaignQuery.refetch(), totalRaisedQuery.refetch()]);
    } catch (err) {
      setMessage(`Close failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const targetDisplay = campaignQuery.data ? formatAmount(BigInt(campaignQuery.data[1])) : '—';
  const timeRemainingSeconds = timeRemainingQuery.data ? Number(timeRemainingQuery.data) : 0;
  const totalEncrypted = totalRaisedQuery.data as string | undefined;
  const hasEncryptedTotal = totalEncrypted && totalEncrypted !== ZERO_HANDLE;
  const userEncrypted = contributionQuery.data as string | undefined;
  const hasUserEncrypted = userEncrypted && userEncrypted !== ZERO_HANDLE;

  return (
    <div className="page">
      <Header />
      <main className="content">
        <section className="hero">
          <div>
            <p className="eyebrow">Confidential cETH fund</p>
            <h2>Fund what matters without leaking the numbers.</h2>
            <p className="lede">
              Contributors send encrypted cETH, while totals stay hidden on-chain. Only you and the fundraiser can
              decrypt the real amounts.
            </p>
          </div>
          <div className="hero-card">
            <div className="stat">
              <span>Campaign</span>
              <strong>{campaignQuery.data ? (campaignQuery.data[0] as string) : 'Loading...'}</strong>
            </div>
            <div className="stat">
              <span>Target</span>
              <strong>{targetDisplay} cETH</strong>
            </div>
            <div className="stat">
              <span>Status</span>
              <strong className={`status ${campaignStatus.toLowerCase().replace(' ', '-')}`}>{campaignStatus}</strong>
            </div>
            <div className="stat">
              <span>Time left</span>
              <strong>{timeRemainingSeconds > 0 ? `${Math.floor(timeRemainingSeconds / 3600)}h` : 'Ended'}</strong>
            </div>
          </div>
        </section>

        {status && <div className={`banner ${status.tone}`}>{status.message}</div>}
        {zamaError && <div className="banner error">{zamaError}</div>}

        {!contractsReady && (
          <div className="banner error">
            Contract addresses are not configured for this build. Deploy to Sepolia and update the config constants.
          </div>
        )}

        <section className="grid">
          <div className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Your position</p>
                <h3>Encrypted totals</h3>
              </div>
              <button
                className="ghost"
                onClick={decryptValues}
                disabled={busy === 'decrypt' || zamaLoading || !contractsReady}
              >
                {busy === 'decrypt' ? 'Decrypting...' : 'Decrypt balances'}
              </button>
            </div>

            <div className="pill-row">
              <div className="pill">
                <p>Total raised</p>
                <strong>{decryptedTotal || (hasEncryptedTotal ? 'Encrypted' : 'Not started')}</strong>
              </div>
              <div className="pill">
                <p>Your contribution</p>
                <strong>{decryptedContribution || (hasUserEncrypted ? 'Encrypted' : 'None yet')}</strong>
              </div>
            </div>

            <p className="helper">
              Decryption relies on the Zama relayer. Connect your wallet and run the request to view private totals.
            </p>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Contribute</p>
                <h3>Send encrypted cETH</h3>
              </div>
              <span className={`badge ${operatorQuery.data ? 'good' : 'warn'}`}>
                {operatorQuery.data ? 'Operator active' : 'Operator needed'}
              </span>
            </div>

            <label className="field">
              <span>Amount (cETH)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={contributionAmount}
                onChange={(e) => setContributionAmount(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Mint amount (cETH)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
              />
            </label>

            <div className="actions">
              <button className="ghost" onClick={mintCeth} disabled={busy === 'mint' || !address}>
                {busy === 'mint' ? 'Minting...' : 'Mint test cETH'}
              </button>
              <button className="ghost" onClick={approveOperator} disabled={busy === 'operator' || !address}>
                {busy === 'operator' ? 'Authorizing...' : 'Authorize contract'}
              </button>
              <button
                className="primary"
                onClick={contribute}
                disabled={busy === 'contribute' || !address || zamaLoading || !contractsReady}
              >
                {busy === 'contribute' ? 'Encrypting...' : 'Contribute'}
              </button>
            </div>

            <p className="helper">
              cETH uses 6 decimals. Operator approval lets the contract move your encrypted tokens for this campaign.
            </p>
          </div>

          <div className="card wide">
            <div className="card-header">
              <div>
                <p className="eyebrow">Fundraiser controls</p>
                <h3>Update campaign</h3>
              </div>
              {!isFundraiserOwner && <span className="badge muted">View only</span>}
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Title</span>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label className="field">
                <span>Target (cETH)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formTarget}
                  onChange={(e) => setFormTarget(e.target.value)}
                />
              </label>
              <label className="field">
                <span>End time</span>
                <input type="datetime-local" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} />
              </label>
            </div>

            <div className="actions">
              <button
                className="ghost"
                onClick={updateCampaign}
                disabled={!isFundraiserOwner || busy === 'campaign'}
              >
                {busy === 'campaign' ? 'Saving...' : 'Save changes'}
              </button>
              <button
                className="danger"
                onClick={closeCampaign}
                disabled={!isFundraiserOwner || busy === 'close'}
              >
                {busy === 'close' ? 'Closing...' : 'Close and withdraw'}
              </button>
            </div>

            <p className="helper">
              Only the fundraiser address can adjust details or close the round. Closing transfers encrypted cETH to the
              fundraiser wallet.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
