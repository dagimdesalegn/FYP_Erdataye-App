import { supabase } from './supabase';

/* ─── Types ──────────────────────────────────────────────────────── */

export interface FirstAidMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/* ─── WHO-based first aid knowledge base (offline fallback) ────── */

const FIRST_AID_KB: Record<string, string> = {
  choking:
    'WHO Choking First Aid:\n' +
    '1. Encourage the person to cough forcefully.\n' +
    '2. If coughing fails, give up to 5 back blows between the shoulder blades using the heel of your hand.\n' +
    '3. If back blows fail, perform up to 5 abdominal thrusts (Heimlich maneuver) — stand behind the person, place your fist above the navel, grasp with the other hand, and thrust inward and upward.\n' +
    '4. Alternate between 5 back blows and 5 abdominal thrusts.\n' +
    '5. If the person becomes unconscious, begin CPR and call emergency services immediately.',

  bleeding:
    'WHO Bleeding Control:\n' +
    '1. Apply direct pressure to the wound using a clean cloth or bandage.\n' +
    '2. If blood soaks through, add more cloth on top without removing the first layer.\n' +
    '3. Elevate the injured limb above the level of the heart if possible.\n' +
    '4. Apply a pressure bandage firmly over the wound.\n' +
    '5. For severe bleeding that won\'t stop, apply a tourniquet 5-7 cm above the wound (as a last resort).\n' +
    '6. Seek emergency medical help immediately for heavy bleeding.',

  burn:
    'WHO Burn First Aid:\n' +
    '1. Remove the person from the source of the burn.\n' +
    '2. Cool the burn under cool (not cold) running water for at least 20 minutes.\n' +
    '3. Remove clothing and jewelry near the burn unless stuck to the skin.\n' +
    '4. Cover the burn loosely with a sterile, non-stick bandage.\n' +
    '5. Do NOT apply ice, butter, toothpaste, or ointments.\n' +
    '6. For severe burns (large area, face/hands/genitals, or deep burns), seek emergency care immediately.\n' +
    '7. Give pain relief if available (paracetamol/ibuprofen).',

  cpr:
    'WHO CPR Guidelines (Adults):\n' +
    '1. Check if the person is responsive — tap shoulders and shout.\n' +
    '2. Call emergency services immediately.\n' +
    '3. Place the person on their back on a firm surface.\n' +
    '4. Place the heel of one hand on the center of the chest (lower sternum), other hand on top.\n' +
    '5. Push hard and fast — at least 5 cm deep, at a rate of 100-120 compressions per minute.\n' +
    '6. After 30 compressions, give 2 rescue breaths (tilt head back, lift chin, seal mouth, blow for 1 second each).\n' +
    '7. Continue 30:2 cycles until help arrives or the person recovers.\n' +
    '8. If you are untrained or unwilling to give breaths, do chest compressions only.',

  fracture:
    'WHO Fracture First Aid:\n' +
    '1. Do not try to straighten the broken bone.\n' +
    '2. Stabilize the injured area — immobilize the joints above and below the fracture.\n' +
    '3. Apply a splint using rigid material (board, rolled newspaper) padded with cloth.\n' +
    '4. Apply ice wrapped in cloth to reduce swelling (20 minutes on, 20 off).\n' +
    '5. For open fractures (bone visible), cover the wound with a clean dressing, do NOT push bone back in.\n' +
    '6. Check circulation below the injury (pulse, skin color, sensation).\n' +
    '7. Seek medical help immediately.',

  seizure:
    'WHO Seizure First Aid:\n' +
    '1. Stay calm and time the seizure.\n' +
    '2. Clear the area of hard or sharp objects.\n' +
    '3. Place something soft under the person\'s head.\n' +
    '4. Turn the person on their side (recovery position) to prevent choking.\n' +
    '5. Do NOT restrain the person or put anything in their mouth.\n' +
    '6. Stay with the person until the seizure ends.\n' +
    '7. Call emergency services if the seizure lasts more than 5 minutes, the person doesn\'t regain consciousness, or it\'s their first seizure.',

  snakebite:
    'WHO Snakebite First Aid:\n' +
    '1. Keep the person calm and still — movement speeds venom spread.\n' +
    '2. Immobilize the bitten limb and keep it below heart level.\n' +
    '3. Remove rings, watches, or tight clothing near the bite.\n' +
    '4. Clean the wound gently with soap and water.\n' +
    '5. Do NOT cut the wound, suck out venom, or apply a tourniquet.\n' +
    '6. Do NOT apply ice or immerse in cold water.\n' +
    '7. Transport to the nearest hospital for antivenom treatment immediately.\n' +
    '8. Try to remember the snake\'s appearance (do not try to catch it).',

  heatstroke:
    'WHO Heatstroke First Aid:\n' +
    '1. Move the person to a cool, shaded area immediately.\n' +
    '2. Remove excess clothing.\n' +
    '3. Cool the person rapidly — apply cool water to skin, fan them, place ice packs on neck, armpits, and groin.\n' +
    '4. If conscious, give small sips of cool water.\n' +
    '5. Do NOT give aspirin or paracetamol.\n' +
    '6. Call emergency services immediately — heatstroke is life-threatening.\n' +
    '7. Monitor breathing and consciousness.',

  drowning:
    'WHO Drowning First Aid:\n' +
    '1. Remove the person from the water safely (do not put yourself at risk).\n' +
    '2. Call emergency services.\n' +
    '3. Check for breathing — if not breathing, begin CPR immediately.\n' +
    '4. Start with 5 rescue breaths, then continue with standard CPR (30 compressions : 2 breaths).\n' +
    '5. Do NOT attempt to drain water from the lungs.\n' +
    '6. Keep the person warm with blankets.\n' +
    '7. Even if the person recovers, they must be evaluated at a hospital.',

  poisoning:
    'WHO Poisoning First Aid:\n' +
    '1. Call emergency services or a poison control center immediately.\n' +
    '2. Try to identify what was ingested, when, and how much.\n' +
    '3. Do NOT induce vomiting unless specifically told to by medical professionals.\n' +
    '4. If the poison is on the skin, remove contaminated clothing and rinse skin with water for 15-20 minutes.\n' +
    '5. If poison is in the eyes, rinse with clean water for 15-20 minutes.\n' +
    '6. If the person is unconscious, place in recovery position.\n' +
    '7. If not breathing, begin CPR.\n' +
    '8. Bring the poison container to the hospital if possible.',

  heartattack:
    'WHO Heart Attack First Aid:\n' +
    '1. Call emergency services immediately.\n' +
    '2. Have the person sit or lie down in a comfortable position.\n' +
    '3. If not allergic, give one adult aspirin (300 mg) to chew slowly.\n' +
    '4. Loosen tight clothing.\n' +
    '5. If the person has prescribed nitroglycerin, help them take it.\n' +
    '6. Monitor breathing and consciousness.\n' +
    '7. If the person becomes unresponsive and stops breathing, begin CPR immediately.\n' +
    '8. Common symptoms: chest pain/pressure, pain in arm/jaw/back, shortness of breath, nausea, sweating.',

  asthma:
    'WHO Asthma Attack First Aid:\n' +
    '1. Help the person sit upright — do not let them lie down.\n' +
    '2. Help them use their reliever inhaler (usually blue) — 1 puff every 30-60 seconds, up to 10 puffs.\n' +
    '3. If using a spacer, give 4 puffs, each with 4 breaths through the spacer.\n' +
    '4. Stay calm and reassure the person.\n' +
    '5. If no improvement after 10 puffs, call emergency services.\n' +
    '6. Repeat inhaler every 10 minutes while waiting for help.\n' +
    '7. If the person becomes unconscious and stops breathing, begin CPR.',

  allergy:
    'WHO Severe Allergic Reaction (Anaphylaxis) First Aid:\n' +
    '1. Call emergency services immediately.\n' +
    '2. If the person has an epinephrine auto-injector (EpiPen), help them use it — inject into outer thigh.\n' +
    '3. Help the person lie down with legs elevated (unless they have breathing difficulty — then sit them up).\n' +
    '4. Loosen tight clothing.\n' +
    '5. If the person stops breathing, begin CPR.\n' +
    '6. Do NOT give anything by mouth if the person is having trouble breathing.\n' +
    '7. A second dose of epinephrine can be given after 5-15 minutes if no improvement.\n' +
    '8. Common triggers: food, insect stings, medications.',

  wound:
    'WHO Wound Care:\n' +
    '1. Wash your hands before treating the wound.\n' +
    '2. Stop bleeding by applying gentle pressure with a clean cloth.\n' +
    '3. Clean the wound gently with clean water — remove dirt and debris.\n' +
    '4. Apply an antiseptic if available.\n' +
    '5. Cover the wound with a sterile bandage.\n' +
    '6. Change dressings daily or when wet/dirty.\n' +
    '7. Seek medical attention for deep wounds, wounds that won\'t stop bleeding, animal bites, or signs of infection (redness, swelling, pus, fever).',

  fainting:
    'WHO Fainting First Aid:\n' +
    '1. Help the person lie down on their back.\n' +
    '2. Elevate their legs about 30 cm (12 inches) above heart level.\n' +
    '3. Loosen belts, collars, or tight clothing.\n' +
    '4. Ensure fresh air — open windows or move to a ventilated area.\n' +
    '5. If the person doesn\'t regain consciousness within 1 minute, call emergency services.\n' +
    '6. Check breathing — if not breathing, begin CPR.\n' +
    '7. When the person recovers, have them sit up slowly and give sips of water.',

  nosebleed:
    'WHO Nosebleed First Aid:\n' +
    '1. Have the person sit upright and lean slightly forward.\n' +
    '2. Pinch the soft part of the nose firmly for 10-15 minutes without releasing.\n' +
    '3. Breathe through the mouth.\n' +
    '4. Apply a cold compress to the bridge of the nose.\n' +
    '5. Do NOT tilt the head back (blood may flow down the throat).\n' +
    '6. Do NOT stuff tissue or cotton deep into the nose.\n' +
    '7. Seek medical attention if bleeding doesn\'t stop after 20 minutes, or if caused by an injury.',
};

/* ─── Keyword matching for offline responses ─────────────────────── */

const KEYWORD_MAP: [RegExp, string][] = [
  [/chok(e|ing)/i, 'choking'],
  [/bleed(ing)?|blood|cut\b|laceration/i, 'bleeding'],
  [/burn(s|ed|ing)?|scald/i, 'burn'],
  [/cpr|cardiopulmonary|chest.?compress|not.?breath/i, 'cpr'],
  [/fracture|broken.?bone|break|sprain|splint/i, 'fracture'],
  [/seizure|convuls|epilep|fit\b/i, 'seizure'],
  [/snake.?bite|bitten.?by.?snake/i, 'snakebite'],
  [/heat.?stroke|heat.?exhaust|overheat/i, 'heatstroke'],
  [/drown(ing|ed)?|submers|water.?rescue/i, 'drowning'],
  [/poison(ing|ed)?|ingest|swallow.*(chemical|clean)/i, 'poisoning'],
  [/heart.?attack|chest.?pain|cardiac|myocard/i, 'heartattack'],
  [/asthma|wheez|inhaler|breath.?difficult/i, 'asthma'],
  [/allerg(y|ic)|anaphyla|epipen|hives|swell.*(face|throat)/i, 'allergy'],
  [/wound|scrape|abrasion|gash/i, 'wound'],
  [/faint(ing|ed)?|pass(ed)?.?out|syncop|dizz(y|iness)/i, 'fainting'],
  [/nose.?bleed|epistax/i, 'nosebleed'],
];

function matchLocalKB(query: string): string | null {
  for (const [regex, key] of KEYWORD_MAP) {
    if (regex.test(query)) {
      return FIRST_AID_KB[key] ?? null;
    }
  }
  return null;
}

/* ─── System prompt for AI backend ───────────────────────────────── */

const SYSTEM_PROMPT = `You are Erdataya First Aid Assistant, an AI chatbot integrated into the Erdataya Ambulance app in Ethiopia. Your role is to provide accurate, clear, and actionable first aid guidance based on World Health Organization (WHO) guidelines.

RULES:
- ONLY answer questions related to first aid, emergency medical situations, health, and wellness.
- If a question is NOT related to health or first aid, politely decline and redirect.
- Always cite WHO guidelines when applicable.
- Provide step-by-step instructions that are easy to follow under stress.
- If the situation sounds life-threatening, ALWAYS advise calling emergency services immediately.
- Be empathetic but concise — people in emergencies need quick, clear answers.
- Do NOT diagnose conditions or prescribe medications.
- Recommend seeking professional medical help after any first aid.
- Respond in the same language the user writes in (support Amharic and English).
- Keep responses under 300 words unless detailed steps are necessary.`;

/* ─── Edge Function / AI API call ────────────────────────────────── */

export async function getFirstAidResponse(
  userMessage: string,
  conversationHistory: FirstAidMessage[],
  userId: string,
  emergencyId?: string,
): Promise<string> {
  // 1. Try local knowledge base first for fast offline responses
  const localAnswer = matchLocalKB(userMessage);

  // 2. Try Supabase Edge Function for AI-powered response
  try {
    const { data: { session } } = await supabase.auth.getSession();

    const historyForApi = conversationHistory.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await fetch(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/first-aid-chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify({
          message: userMessage,
          history: historyForApi,
          systemPrompt: SYSTEM_PROMPT,
        }),
      },
    );

    if (response.ok) {
      const data = await response.json();
      if (data?.reply) {
        // Persist to chat history if linked to an emergency
        if (emergencyId) {
          persistMessage(emergencyId, userId, userMessage, data.reply);
        }
        return data.reply;
      }
    }
  } catch {
    // Edge function unavailable — fall through to local KB
  }

  // 3. Fallback to local knowledge base
  if (localAnswer) {
    if (emergencyId) {
      persistMessage(emergencyId, userId, userMessage, localAnswer);
    }
    return localAnswer;
  }

  // 4. Generic fallback
  const fallback =
    'I can help with first aid topics such as:\n\n' +
    '• Choking\n• Bleeding & wound care\n• Burns\n• CPR\n• Fractures\n• Seizures\n' +
    '• Snake bites\n• Heatstroke\n• Drowning\n• Poisoning\n• Heart attack\n' +
    '• Asthma attacks\n• Allergic reactions\n• Fainting\n• Nosebleeds\n\n' +
    'Please describe your emergency or ask about any of these topics. ' +
    'If this is a life-threatening emergency, request an ambulance through the app immediately.';

  if (emergencyId) {
    persistMessage(emergencyId, userId, userMessage, fallback);
  }
  return fallback;
}

/* ─── Persist to Supabase ────────────────────────────────────────── */

async function persistMessage(
  emergencyId: string,
  userId: string,
  userMessage: string,
  aiResponse: string,
) {
  try {
    await supabase.from('chat_history').insert({
      emergency_request_id: emergencyId,
      user_id: userId,
      user_message: userMessage,
      ai_response: aiResponse,
    });
  } catch {
    // Non-critical — don't block the UX
  }
}

/* ─── Quick-reply suggestions ────────────────────────────────────── */

export const QUICK_REPLIES = [
  'How do I perform CPR?',
  'First aid for choking',
  'How to stop bleeding',
  'What to do for burns',
  'Heart attack symptoms',
  'Snakebite first aid',
  'Help with a seizure',
  'Asthma attack help',
];
