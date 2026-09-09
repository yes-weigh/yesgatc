import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { FirestoreUserDoc } from '../types';
import {
  rcCertificationMethodFromUser,
  rcUsesManualSignedUpload,
  rcUsesPdfSigner,
  type RcCertificationMethod,
} from './rcCertificationMethod';

export function useRcSignerProfile(rcUid: string | null | undefined): {
  method: RcCertificationMethod | null;
  pdfSigner: boolean;
  manualUpload: boolean;
} {
  const [profile, setProfile] = useState<Pick<
    FirestoreUserDoc,
    'certificationMethod' | 'emaapSignerType'
  > | null>(null);

  useEffect(() => {
    if (!rcUid) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, 'users', rcUid))
      .then(snap => {
        if (cancelled) return;
        const data = snap.data() as FirestoreUserDoc | undefined;
        setProfile(
          data
            ? {
                certificationMethod: data.certificationMethod,
                emaapSignerType: data.emaapSignerType,
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rcUid]);

  return {
    method: profile ? rcCertificationMethodFromUser(profile) : null,
    pdfSigner: rcUsesPdfSigner(profile),
    manualUpload: rcUsesManualSignedUpload(profile),
  };
}
