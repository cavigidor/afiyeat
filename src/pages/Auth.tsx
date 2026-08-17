import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { OTPVerification } from '@/components/auth/OTPVerification';
import { PasswordRequirements, getPasswordStrength } from '@/components/auth/PasswordRequirements';
import { supabase } from '@/integrations/supabase/client';
import { getEdgeFunctionErrorMessage } from '@/lib/edgeFunctionError';
import logo from '@/assets/logo.png';
import { Seo } from '@/components/Seo';

const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const resetPasswordSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  confirmNewPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "Passwords don't match",
  path: ['confirmNewPassword'],
});
type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

const signUpSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(20),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

interface PendingSignUp {
  email: string;
  password: string;
  username: string;
}

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  );
  const [showOTPVerification, setShowOTPVerification] = useState(false);
  const [pendingSignUp, setPendingSignUp] = useState<PendingSignUp | null>(null);

  useEffect(() => {
    if (user) {
      navigate('/news');
    }
  }, [user, navigate]);

  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const signUpForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState<'email' | 'code'>('email');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResending, setForgotResending] = useState(false);

  const resetPasswordForm = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { code: '', newPassword: '', confirmNewPassword: '' },
  });

  const resetForgotFlow = () => {
    setForgotMode(false);
    setForgotStep('email');
    setForgotEmail('');
    resetPasswordForm.reset();
  };

  // Sends (or resends) the 6-digit code. Reuses the same send-otp function
  // as sign-up - it doesn't care why an email needs verifying.
  const handleSendResetCode = async () => {
    if (!forgotEmail) {
      toast.error('Please enter your email address');
      return;
    }
    setForgotLoading(true);
    try {
      await sendOTP(forgotEmail);
      toast.success('Verification code sent! Check your email.');
      setForgotStep('code');
    } catch (error: any) {
      toast.error(error.message || 'Failed to send verification code');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResendResetCode = async () => {
    setForgotResending(true);
    try {
      await sendOTP(forgotEmail);
      toast.success('New verification code sent');
    } catch (error: any) {
      toast.error(error.message || 'Failed to resend code');
    } finally {
      setForgotResending(false);
    }
  };

  const handleResetPasswordSubmit = async (values: ResetPasswordValues) => {
    const strength = getPasswordStrength(values.newPassword);
    if (strength.score < 2) {
      toast.error('Please choose a stronger password');
      return;
    }

    setForgotLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: {
          email: forgotEmail,
          otp_code: values.code,
          new_password: values.newPassword,
        },
      });

      if (error) {
        throw new Error(await getEdgeFunctionErrorMessage(error, 'Failed to reset password'));
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      // Password reset server-side - sign in with it right away.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: forgotEmail,
        password: values.newPassword,
      });

      if (signInError) {
        toast.success('Password reset! Please sign in.');
        resetForgotFlow();
        setActiveTab('signin');
      } else {
        toast.success('Password reset! Welcome back.');
        navigate('/news');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleSignIn = async (values: SignInValues) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    setLoading(false);

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        toast.error('Invalid email or password');
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success('Welcome back!');
      navigate('/news');
    }
  };

  const sendOTP = async (email: string) => {
    const { data, error } = await supabase.functions.invoke('send-otp', {
      body: { email },
    });

    if (error) {
      throw new Error(await getEdgeFunctionErrorMessage(error, 'Failed to send verification code'));
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  };

  const handleSignUpSubmit = async (values: SignUpValues) => {
    // Check password strength before proceeding
    const strength = getPasswordStrength(values.password);
    if (strength.score < 2) {
      toast.error('Please choose a stronger password');
      return;
    }

    setLoading(true);
    try {
      // Send OTP to email
      await sendOTP(values.email);
      
      // Store pending signup data
      setPendingSignUp({
        email: values.email,
        password: values.password,
        username: values.username,
      });
      
      // Show OTP verification screen
      setShowOTPVerification(true);
      toast.success('Verification code sent to your email');
    } catch (error: any) {
      toast.error(error.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (code: string) => {
    if (!pendingSignUp) return;

    setLoading(true);
    try {
      // Call server-side create-account function that verifies OTP and creates account atomically
      const { data, error } = await supabase.functions.invoke('create-account', {
        body: { 
          email: pendingSignUp.email, 
          password: pendingSignUp.password,
          username: pendingSignUp.username,
          otp_code: code 
        },
      });

      if (error) {
        throw new Error(await getEdgeFunctionErrorMessage(error, 'Account creation failed'));
      }

      if (data?.error) {
        toast.error(data.error);
        setLoading(false);
        return;
      }

      if (data?.success) {
        // Account created server-side, now sign in
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: pendingSignUp.email,
          password: pendingSignUp.password,
        });

        if (signInError) {
          toast.error('Account created but sign-in failed. Please sign in manually.');
          setShowOTPVerification(false);
          setPendingSignUp(null);
          setActiveTab('signin');
        } else {
          toast.success('Account created! Welcome to Afiyeat!');
          navigate('/news');
        }
      }
    } catch (error: any) {
      toast.error(error.message || 'Account creation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (!pendingSignUp) return;

    try {
      await sendOTP(pendingSignUp.email);
      toast.success('New verification code sent');
    } catch (error: any) {
      toast.error(error.message || 'Failed to resend code');
    }
  };

  const handleBackToSignUp = () => {
    setShowOTPVerification(false);
    setPendingSignUp(null);
  };

  if (showOTPVerification && pendingSignUp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/20 to-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
              <img src={logo} alt="Afiyeat" className="h-28 w-28 object-contain" />
            </div>
            <CardTitle className="text-2xl">Afiyeat</CardTitle>
          </CardHeader>
          <CardContent>
            <OTPVerification
              email={pendingSignUp.email}
              onVerify={handleVerifyOTP}
              onResend={handleResendOTP}
              onBack={handleBackToSignUp}
              loading={loading}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/20 to-background p-4">
      <Seo
        title="Sign In or Sign Up | Afiyeat"
        description="Sign in or create your free Afiyeat account to track restaurants, save places you've been, and share recipes with friends."
        path="/auth"
      />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src={logo} alt="Afiyeat" className="h-28 w-28 object-contain" />
          </div>
          <CardTitle className="text-2xl">
            <h1 className="text-2xl font-semibold leading-none">Welcome to Afiyeat</h1>
          </CardTitle>
          <CardDescription>
            Track your favorite restaurants and discover new ones with friends
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-6">
              {forgotMode ? (
                forgotStep === 'email' ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Enter your email and we'll send you a 6-digit code to reset your password.
                    </p>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Email</label>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                      />
                    </div>
                    <Button onClick={handleSendResetCode} className="w-full" disabled={forgotLoading}>
                      {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Send Code
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={resetForgotFlow}>
                      Back to Sign In
                    </Button>
                  </div>
                ) : (
                  <Form {...resetPasswordForm}>
                    <form
                      onSubmit={resetPasswordForm.handleSubmit(handleResetPasswordSubmit)}
                      className="space-y-4"
                    >
                      <p className="text-sm text-muted-foreground">
                        We sent a 6-digit code to <span className="font-medium">{forgotEmail}</span>
                      </p>
                      <FormField
                        control={resetPasswordForm.control}
                        name="code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Verification Code</FormLabel>
                            <FormControl>
                              <Input placeholder="123456" inputMode="numeric" maxLength={6} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={resetPasswordForm.control}
                        name="newPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>New Password</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="••••••••" {...field} />
                            </FormControl>
                            <PasswordRequirements password={field.value} />
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={resetPasswordForm.control}
                        name="confirmNewPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Confirm New Password</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="••••••••" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="submit" className="w-full" disabled={forgotLoading}>
                        {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Reset Password
                      </Button>
                      <div className="flex flex-col gap-2 text-center text-sm">
                        <p className="text-muted-foreground">
                          Didn't receive the code?{' '}
                          <button
                            type="button"
                            onClick={handleResendResetCode}
                            disabled={forgotResending}
                            className="text-primary hover:underline disabled:opacity-50"
                          >
                            {forgotResending ? 'Sending...' : 'Resend code'}
                          </button>
                        </p>
                        <Button variant="ghost" className="w-full" onClick={resetForgotFlow}>
                          Back to Sign In
                        </Button>
                      </div>
                    </form>
                  </Form>
                )
              ) : (
              <Form {...signInForm}>
                <form onSubmit={signInForm.handleSubmit(handleSignIn)} className="space-y-4">
                  <FormField
                    control={signInForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signInForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="link"
                      className="px-0 text-sm text-muted-foreground"
                      onClick={() => setForgotMode(true)}
                    >
                      Forgot password?
                    </Button>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign In
                  </Button>
                </form>
              </Form>
              )}
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <Form {...signUpForm}>
                <form onSubmit={signUpForm.handleSubmit(handleSignUpSubmit)} className="space-y-4">
                  <FormField
                    control={signUpForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder="foodlover123" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
                        </FormControl>
                        <PasswordRequirements password={field.value} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Continue
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="about" className="mt-6">
              <div className="space-y-4 text-sm text-muted-foreground max-h-[400px] overflow-y-auto pr-2">
                <p className="text-foreground font-medium">
                  In Turkish, there is a beautiful phrase often shared at the beginning or end of a meal: <span className="italic">"Afiyet olsun."</span> While it is the Turkish equivalent of bon appétit, its literal meaning is much deeper. It translates to "may it be health." It is a wish that the food you consume brings you not just pleasure, but wellness and vitality. That spirit of health, joy, and connection is the heartbeat of this platform.
                </p>

                <div>
                  <h4 className="font-semibold text-foreground mb-2">Why I Built This</h4>
                  <p>
                    Afiyeat was born out of my own love and hate relationship with dining out. Like many food lovers, I am incredibly indecisive when it comes to choosing where to eat. I would find myself scrolling endlessly through generic reviews, never quite sure what I was in the mood for or if a place was actually worth the trip.
                  </p>
                  <p className="mt-2">
                    I wanted a place where I could keep track of my own food journey visually. I wanted a digital scrapbook of the flavors I have discovered and the places I want to go. More than that, I wanted a way to see what my friends actually like. There is no better recommendation than one from someone you trust, and having a visual dashboard of their favorites makes those "where should we eat?" decisions a whole lot easier.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-foreground mb-2">More Than Just Restaurants</h4>
                  <p>
                    Food is not just about going out. It is about what we create in our own kitchens. I added the Recipe Section because I have always loved the process of trying new things, making my own culinary creations, and sharing them with a community.
                  </p>
                  <p className="mt-2">
                    Whether you are here to document your favorite local hidden gems or to learn a new dish from someone else's kitchen, Afiyeat is a space for us to learn from each other. It is a community built for the curious, the indecisive, and the hungry.
                  </p>
                </div>

                <p className="text-foreground font-medium italic text-center pt-2">
                  So, dive in, explore, and as they say in Turkey: Afiyet olsun!
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}
