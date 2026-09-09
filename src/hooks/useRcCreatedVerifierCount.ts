import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { rcVerifierMembersRef } from '../lib/rcVerifierMembers';

/** Live roster size for RC-created verifiers (`rcVerifiers/{rcId}/members`). */
export function useRcCreatedVerifierCount(rcUid: string | null | undefined): {
  count: number;
  ready: boolean;
} {
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(!rcUid);

  useEffect(() => {
    if (!rcUid) {
      setCount(0);
      setReady(true);
      return;
    }
    setReady(false);
    return onSnapshot(
      rcVerifierMembersRef(rcUid),
      snap => {
        setCount(snap.size);
        setReady(true);
      },
      () => {
        setCount(0);
        setReady(true);
      },
    );
  }, [rcUid]);

  return { count, ready };
}
