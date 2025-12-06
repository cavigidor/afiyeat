import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, query, restaurants } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    let systemPrompt = '';
    let userPrompt = '';

    switch (action) {
      case 'suggest':
        systemPrompt = `You are a helpful restaurant recommendation assistant. Based on the user's query and their saved restaurants, suggest relevant places or provide helpful tips. Be concise and friendly. Format suggestions as a brief list if multiple. Keep responses under 150 words.`;
        userPrompt = `User's saved restaurants: ${JSON.stringify(restaurants?.map((r: any) => ({ name: r.name, address: r.address, status: r.status, folder: r.folder?.name })) || [])}\n\nUser query: ${query}`;
        break;
      case 'categorize':
        systemPrompt = `You are a restaurant categorization assistant. Suggest the best folder/category for a restaurant based on its name and address. Be very brief - just respond with the category name. Common categories: Cafes, Brunch, Lunch, Dinner, Fine Dining, Fast Food, Bars, Desserts, Asian, Italian, Mexican, etc.`;
        userPrompt = `Restaurant: ${query}`;
        break;
      case 'describe':
        systemPrompt = `You are a food writer. Write a brief, enticing 1-2 sentence description of what to expect at this restaurant based on its name. Be creative but realistic.`;
        userPrompt = `Restaurant name: ${query}`;
        break;
      default:
        systemPrompt = `You are a helpful restaurant assistant. Answer questions about food, restaurants, and dining. Keep responses concise and helpful.`;
        userPrompt = query;
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add credits.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error('AI service error');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || 'No response generated';

    return new Response(JSON.stringify({ response: content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('AI assistant error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
