import { submitReport } from '@/lib/moderation';

export async function repro() {
  const result = await submitReport({ reportedUserId: 'x', reason: 'spam' });
  if (result.ok) {
    return;
  }
  if (result.reason === 'duplicate') {
    console.log(result.message);
  }
  console.log(result.message);
}
