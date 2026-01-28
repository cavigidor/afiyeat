import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Loader2, ArrowLeft } from 'lucide-react';

interface OTPVerificationProps {
  email: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onBack: () => void;
  loading: boolean;
}

export function OTPVerification({
  email,
  onVerify,
  onResend,
  onBack,
  loading,
}: OTPVerificationProps) {
  const [code, setCode] = useState('');
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length === 6) {
      await onVerify(code);
    }
  };

  const handleResend = async () => {
    setResending(true);
    await onResend();
    setResending(false);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-xl font-semibold">Verify your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to <span className="font-medium">{email}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            disabled={loading}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={loading || code.length !== 6}
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify Email
        </Button>
      </form>

      <div className="flex flex-col gap-2 text-center text-sm">
        <p className="text-muted-foreground">
          Didn't receive the code?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-primary hover:underline disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Resend code'}
          </button>
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to signup
        </button>
      </div>
    </div>
  );
}
