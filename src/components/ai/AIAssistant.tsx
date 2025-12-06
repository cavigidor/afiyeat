import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, Send, Loader2, X, Lightbulb, Tag, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AIAssistantProps {
  restaurants: any[];
}

export function AIAssistant({ restaurants }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const askAI = async (action: string, customQuery?: string) => {
    setLoading(true);
    setResponse('');

    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action, query: customQuery || query, restaurants },
      });

      if (error) throw error;
      
      if (data.error) {
        toast.error(data.error);
        return;
      }

      setResponse(data.response);
    } catch (error: any) {
      toast.error(error.message || 'Failed to get AI response');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      askAI('suggest', query);
    }
  };

  const quickActions = [
    { icon: Lightbulb, label: 'Suggest a restaurant', action: 'suggest', query: 'Suggest a restaurant for tonight based on my saved places' },
    { icon: Tag, label: 'Help categorize', action: 'categorize', query: 'What categories do my restaurants fit into?' },
    { icon: FileText, label: 'Dining tips', action: 'general', query: 'Give me some tips for trying new restaurants' },
  ];

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="gap-2 border-primary/30 hover:border-primary hover:bg-primary/5"
      >
        <Sparkles className="h-4 w-4 text-primary" />
        AI Assistant
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 max-w-[calc(100vw-2rem)] bg-card border rounded-xl shadow-xl z-50">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <span className="font-semibold">AI Assistant</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
        {!response && !loading && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Quick actions:</p>
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => {
                  setQuery(action.query);
                  askAI(action.action, action.query);
                }}
                className="w-full flex items-center gap-3 p-3 text-left rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <action.icon className="h-4 w-4 text-primary" />
                <span className="text-sm">{action.label}</span>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {response && (
          <div className="space-y-3">
            <div className="bg-primary/10 rounded-lg p-3">
              <p className="text-sm text-muted-foreground mb-1">You asked:</p>
              <p className="text-sm font-medium">{query}</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm whitespace-pre-wrap">{response}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setResponse('');
                setQuery('');
              }}
              className="w-full"
            >
              Ask another question
            </Button>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about restaurants..."
            disabled={loading}
          />
          <Button type="submit" size="icon" disabled={loading || !query.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
