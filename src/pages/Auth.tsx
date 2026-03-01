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
import logo from '@/assets/logo.png';

const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

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
  const { user, signUp } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  );
  const [showOTPVerification, setShowOTPVerification] = useState(false);
  const [pendingSignUp, setPendingSignUp] = useState<PendingSignUp | null>(null);

  useEffect(() => {
    if (user) {
      navigate('/my-list');
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
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleForgotPassword = async () => {
    if (!forgotEmail) {
      toast.error('Please enter your email address');
      return;
    }
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setForgotLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password reset link sent! Check your email.');
      setForgotMode(false);
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
      navigate('/my-list');
    }
  };

  const sendOTP = async (email: string) => {
    const { data, error } = await supabase.functions.invoke('send-otp', {
      body: { email },
    });

    if (error) {
      throw new Error(error.message || 'Failed to send verification code');
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
      // Verify the OTP
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { email: pendingSignUp.email, code },
      });

      if (error) {
        throw new Error(error.message || 'Verification failed');
      }

      if (!data?.valid) {
        toast.error(data?.error || 'Invalid verification code');
        setLoading(false);
        return;
      }

      // OTP verified, create the account
      const { error: signUpError } = await signUp(
        pendingSignUp.email,
        pendingSignUp.password,
        pendingSignUp.username
      );

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          toast.error('An account with this email already exists');
        } else if (
          signUpError.message.includes('duplicate key') ||
          signUpError.message.includes('profiles_username_key') ||
          signUpError.message.includes('Database error')
        ) {
          toast.error('Username already exists. Please choose a different one.');
        } else {
          toast.error(signUpError.message);
        }
      } else {
        toast.success('Account created! Welcome to Afiyeat!');
        navigate('/my-list');
      }
    } catch (error: any) {
      toast.error(error.message || 'Verification failed');
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/20 to-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src={logo} alt="Afiyeat" className="h-28 w-28 object-contain" />
          </div>
          <CardTitle className="text-2xl">Afiyeat</CardTitle>
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
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter your email and we'll send you a link to reset your password.
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
                  <Button onClick={handleForgotPassword} className="w-full" disabled={forgotLoading}>
                    {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send Reset Link
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => setForgotMode(false)}>
                    Back to Sign In
                  </Button>
                </div>
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
    </div>
  );
}
