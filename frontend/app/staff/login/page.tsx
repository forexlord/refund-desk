import { Suspense } from 'react';
import { SignInForm } from '@/components/SignInForm';

export default function StaffLoginPage() {
  return (
    <Suspense>
      <SignInForm audience="staff" />
    </Suspense>
  );
}
