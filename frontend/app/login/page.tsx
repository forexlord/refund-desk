import { Suspense } from 'react';
import { SignInForm } from '@/components/SignInForm';

export default function LoginPage() {
  // Suspense: the form reads ?expired=1 via useSearchParams.
  return (
    <Suspense>
      <SignInForm audience="customer" />
    </Suspense>
  );
}
