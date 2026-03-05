/**
 * First Aid Chatbot — WHO-based knowledge base and response engine.
 * All guidance is derived from World Health Organization (WHO) first aid guidelines,
 * WHO Basic Emergency Care (BEC) manuals, and Ethiopian Ministry of Health protocols.
 *
 * IMPORTANT DISCLAIMER: This chatbot provides general first aid information only.
 * It is NOT a substitute for professional medical care. Always call emergency services
 * (dial 911) immediately in life-threatening situations.
 */

export interface ChatTopic {
  id: string;
  label: string;
  keywords: string[];
  icon: string;
}

export interface BotMessage {
  role: 'bot';
  text: string;
  followUps?: string[];
}

export interface UserMessage {
  role: 'user';
  text: string;
}

export type Message = BotMessage | UserMessage;

// ─────────────────────────────────────────────────────────────────────────────
// Quick-access topic suggestions shown on chat start
// ─────────────────────────────────────────────────────────────────────────────
export const QUICK_TOPICS: ChatTopic[] = [
  { id: 'cpr', label: 'CPR', keywords: ['cpr'], icon: 'favorite' },
  { id: 'bleeding', label: 'Bleeding', keywords: ['bleed'], icon: 'water-drop' },
  { id: 'choking', label: 'Choking', keywords: ['chok'], icon: 'air' },
  { id: 'burns', label: 'Burns', keywords: ['burn'], icon: 'local-fire-department' },
  { id: 'stroke', label: 'Stroke', keywords: ['stroke'], icon: 'psychology' },
  { id: 'fracture', label: 'Fracture', keywords: ['fractur', 'broken bone'], icon: 'accessibility' },
  { id: 'poisoning', label: 'Poisoning', keywords: ['poison'], icon: 'warning' },
  { id: 'shock', label: 'Shock', keywords: ['shock'], icon: 'flash-on' },
];

// ─────────────────────────────────────────────────────────────────────────────
// WHO first aid knowledge base
// ─────────────────────────────────────────────────────────────────────────────
interface KBEntry {
  keywords: string[];
  response: string;
  followUps: string[];
}

const KB: KBEntry[] = [
  // ── CPR / Cardiac Arrest ────────────────────────────────────────────────
  {
    keywords: ['cpr', 'cardiac arrest', 'heart attack', 'heart stop', 'not breathing', 'unconscious', 'no pulse', 'resuscitat'],
    response: `🫀 **CPR (Cardiopulmonary Resuscitation) — WHO Guidelines**

**CALL 911 IMMEDIATELY before starting CPR.**

**Step-by-step:**
1. **Check safety** — Make sure the scene is safe.
2. **Check responsiveness** — Tap shoulders firmly and shout "Are you OK?"
3. **Call for help** — Shout for someone to call 911. If alone, call yourself.
4. **Open airway** — Tilt head back, lift chin gently.
5. **Check breathing** — Look, listen and feel for ≤10 seconds.
6. **Start chest compressions:**
   • Place heel of hand on centre of chest (lower half of breastbone).
   • Interlock both hands, keep arms straight.
   • Push down at least **5 cm (2 inches)** at a rate of **100–120 per minute**.
   • Allow full chest recoil between compressions.
7. **Give rescue breaths (if trained):** 30 compressions → 2 breaths. If untrained, do hands-only CPR.
8. **Continue** until: professional help arrives, an AED is available, the person shows signs of life, or you are too exhausted to continue.

⚠️ *This information follows WHO Basic Emergency Care (BEC) guidelines. Professional training is strongly recommended.*`,
    followUps: ['How to use an AED?', 'CPR for children', 'How do I know if CPR is working?'],
  },

  // ── AED ─────────────────────────────────────────────────────────────────
  {
    keywords: ['aed', 'defibrillat'],
    response: `⚡ **Using an AED (Automated External Defibrillator)**

**CALL 911 FIRST. Continue CPR until the AED is ready.**

**Steps:**
1. **Power on** the AED (press the button or open the lid).
2. **Attach pads** as shown in the diagram — one below the right collarbone, one on the lower-left side of the chest.
3. **Plug in the connector** if required.
4. **Stand clear** — make sure nobody is touching the patient, then press the "Analyse" button.
5. **If shock advised** — shout "CLEAR!", ensure no one is touching, then press the shock button.
6. **Resume CPR immediately** after the shock for 2 minutes, then let the AED re-analyse.
7. **If no shock advised** — resume CPR immediately.

Keep the AED on and follow voice prompts. It will guide you automatically.`,
    followUps: ['Back to CPR steps', 'CPR for children'],
  },

  // ── CPR Children ─────────────────────────────────────────────────────────
  {
    keywords: ['cpr child', 'infant cpr', 'baby cpr', 'child resuscitat', 'pediatric cpr'],
    response: `👶 **CPR for Children (1–8 years) & Infants (under 1 year)**

**CALL 911 FIRST.**

**For children (1–8 years):**
• Use **one or two hands** (whatever achieves adequate depth).
• Compress at least **one-third** of chest depth (~5 cm).
• Rate: **100–120 per minute**.
• 30 compressions → 2 gentle breaths.

**For infants (under 1 year):**
• Use **two fingers** (or encircling thumbs technique).
• Compress **one-third** of chest depth (~4 cm).
• Rate: **100–120 per minute**.
• 30 compressions → 2 very gentle puffs (enough to see chest rise).

Give 5 initial rescue breaths before starting compressions for children/infants, if you are trained.`,
    followUps: ['Adult CPR steps', 'Choking in children'],
  },

  // ── Severe Bleeding ──────────────────────────────────────────────────────
  {
    keywords: ['bleed', 'haemorrhag', 'hemorrhag', 'blood loss', 'cut', 'wound', 'lacerat'],
    response: `🩸 **Controlling Severe Bleeding — WHO Guidelines**

**CALL 911 for life-threatening bleeding.**

**Steps:**
1. **Put on gloves** or use a barrier (plastic bag) if available.
2. **Apply direct pressure** — Use a clean cloth or dressing. Press firmly on the wound.
3. **Maintain pressure** — Do NOT remove the cloth; if it soaks through, add more on top.
4. **Elevate the injured limb** above heart level (unless fracture suspected).
5. **Tourniquet (limb only, life-threatening):** Apply 5–7 cm above the wound. Note the time. Do not remove once applied.
6. **Wound packing:** For deep wounds, pack tight with gauze/clean cloth and apply firm pressure.
7. **Keep the patient warm** — Lay them flat, cover with a blanket to reduce shock.
8. **Monitor** for signs of shock: pale/cold/clammy skin, rapid weak pulse, confusion.

⚠️ *Do NOT remove an embedded object from a wound — apply pressure around it instead.*`,
    followUps: ['Signs of shock', 'Wound care & infection', 'Nosebleed'],
  },

  // ── Nosebleed ────────────────────────────────────────────────────────────
  {
    keywords: ['nosebleed', 'nose bleed', 'epistaxis'],
    response: `👃 **Nosebleed First Aid**

1. **Sit upright** and **lean slightly forward** (not backward — avoids swallowing blood).
2. **Pinch the soft part** of the nose (below the bony bridge) firmly.
3. **Breathe through the mouth** and hold pressure for **10–15 minutes** without releasing.
4. **Apply a wrapped cold pack** to the bridge of the nose.
5. Do NOT tilt head back, pack with tissue deep into the nose, or blow nose immediately after.

**Seek emergency care if:**
• Bleeding does not stop after 30 minutes.
• Caused by a head injury.
• There is a large amount of blood loss.
• The person is on blood thinners.`,
    followUps: ['Controlling severe bleeding', 'Head injury'],
  },

  // ── Choking ─────────────────────────────────────────────────────────────
  {
    keywords: ['chok', 'airway obstruct', 'can\'t breathe', 'heimlich', 'foreign body airway'],
    response: `🫁 **Choking — WHO/ILCOR Guidelines**

**CALL 911 if the person cannot cough, speak, or breathe.**

**Conscious adult or child (over 1 year):**
1. **Encourage coughing** if they can cough forcefully.
2. **5 back blows** — Lean person forward, give 5 firm blows between shoulder blades with the heel of your hand.
3. **5 abdominal thrusts (Heimlich manoeuvre):**
   • Stand behind the person, wrap your arms around their waist.
   • Make a fist above the navel (below the breastbone), cover with other hand.
   • Give 5 sharp inward-and-upward thrusts.
4. **Alternate** 5 back blows and 5 abdominal thrusts until the object is dislodged or person loses consciousness.

**If person becomes unconscious:** Start CPR immediately. Each time you open the airway, look for the object and remove it if visible.

**Pregnant or obese persons:** Use chest thrusts instead of abdominal thrusts.

**Infants (under 1 year):**
• 5 back blows (face-down on your forearm).
• 5 chest thrusts (2 fingers on lower half of breastbone, face-up on your forearm).`,
    followUps: ['CPR steps', 'Choking in infants'],
  },

  // ── Burns ────────────────────────────────────────────────────────────────
  {
    keywords: ['burn', 'scald', 'fire injury', 'thermal injury', 'chemical burn'],
    response: `🔥 **Burns First Aid — WHO Guidelines**

**CALL 911 for large, deep, or chemical burns.**

**Immediate steps (all burns):**
1. **Stop the burning** — Remove from heat source; smother flames (stop, drop, roll).
2. **Cool the burn** — Run cool (NOT cold/iced) water over the burn for **at least 20 minutes**. Start within 3 hours of injury.
3. **Remove clothing/jewellery** near the burn — but NOT if stuck to skin.
4. **Cover loosely** with a clean, non-fluffy material (cling film lengthways, not wrapped around).
5. **Do NOT** apply butter, toothpaste, ice, or creams.

**Chemical burns:**
• Brush off dry chemicals first.
• Rinse with large amounts of water for 20+ minutes.
• Remove contaminated clothing (protect yourself).

**Seek immediate care if burn:**
• Is larger than the palm of the hand.
• Affects face, hands, feet, genitals, joints, or goes all around a limb.
• Is deep (white/charred/leathery — often painless).
• Caused by chemicals, electricity, or inhalation.

**Electrical burns:** Always seek emergency care — internal damage may not be visible.`,
    followUps: ['Wound care & infection', 'Signs of shock'],
  },

  // ── Stroke ───────────────────────────────────────────────────────────────
  {
    keywords: ['stroke', 'brain attack', 'facial droop', 'face drooping', 'arm weakness', 'slurred speech', 'fast sign'],
    response: `🧠 **Stroke Recognition & First Aid — WHO/FAST**

**⏱️ Time is brain! CALL 911 IMMEDIATELY.**

**Use the FAST test:**
• **F — Face:** Ask them to smile. Is one side drooping?
• **A — Arms:** Ask them to raise both arms. Does one drift down?
• **S — Speech:** Ask them to repeat a simple phrase. Is it slurred or strange?
• **T — Time:** If ANY of these signs — call 911 NOW and note the time symptoms started.

**Other symptoms:** Sudden severe headache, sudden vision loss, sudden loss of balance or coordination, sudden confusion.

**While waiting for help:**
1. Keep them calm and still; help them sit or lie in a safe, comfortable position.
2. Do NOT give food, water, or medication.
3. Loosen tight clothing around the neck.
4. If unconscious and breathing, place in **recovery position**.
5. Be ready to start CPR if they stop breathing.
6. Note the exact time symptoms started — critical for treatment decisions.

⚠️ *Clot-busting treatments work best within 4.5 hours of symptom onset. Speed saves lives.*`,
    followUps: ['Recovery position', 'CPR steps'],
  },

  // ── Heart Attack ─────────────────────────────────────────────────────────
  {
    keywords: ['heart attack', 'myocardial infarct', 'mi ', 'chest pain', 'chest tightness', 'chest pressure'],
    response: `❤️ **Heart Attack First Aid — WHO Guidelines**

**CALL 911 IMMEDIATELY.**

**Recognise a heart attack:**
• Chest pain, pressure, tightness, or squeezing (may spread to arm, jaw, neck, back).
• Shortness of breath, sweating, nausea, or light-headedness.
• Women may have atypical symptoms: fatigue, jaw pain, back pain.

**Steps while waiting for help:**
1. **Call 911 immediately** and keep the line open.
2. **Rest** — Have the person sit or lie in the most comfortable position (usually sitting, raised knees).
3. **Loosen tight clothing** (collar, belt, tie).
4. **Aspirin** — If the person is not allergic and able to swallow, give ONE standard aspirin (300 mg) to chew (do not swallow whole). Only if conscious and not contra-indicated.
5. **Reassure** — keep them calm and still.
6. **Be ready** to perform CPR if they lose consciousness and stop breathing normally.
7. **Do NOT** leave the person alone.

⚠️ *Do not give aspirin if they're already taking blood thinners, are under 16, or have aspirin allergy.*`,
    followUps: ['CPR steps', 'Signs of shock'],
  },

  // ── Fractures / Broken Bones ────────────────────────────────────────────
  {
    keywords: ['fractur', 'broken bone', 'broken arm', 'broken leg', 'sprain', 'dislocat'],
    response: `🦴 **Fractures & Broken Bones — WHO First Aid**

**CALL 911 for open fractures, spine injuries, or loss of sensation.**

**General steps:**
1. **Do NOT move the person** if a spine/neck/back injury is suspected.
2. **Stop any bleeding** — Apply gentle pressure around (not on) the fracture.
3. **Immobilise the injured area** — support it in the position YOU FIND IT using padding (clothing, towels) or a splint.
4. **Do NOT try to straighten or set** the bone.
5. **Apply ice pack wrapped in cloth** to reduce swelling (20 min on, 20 min off).
6. **Elevate** the injured limb if possible and no spine injury is suspected.
7. **Monitor** for signs of shock.

**Splinting:**
• The splint should extend beyond the joint above AND below the fracture.
• Pad well; tie firmly but not too tight (check circulation every 15 minutes).

**Seek immediate care for:**
• Open fractures (bone visible or wound near fracture).
• Suspected spine, pelvis, or femur fractures.
• Numbness, tingling, or loss of movement below the injury.`,
    followUps: ['Signs of shock', 'Wound care & infection'],
  },

  // ── Poisoning ────────────────────────────────────────────────────────────
  {
    keywords: ['poison', 'overdos', 'toxic', 'ingested', 'swallow chemical', 'drug overdose', 'alcohol overdose'],
    response: `☠️ **Poisoning First Aid — WHO Guidelines**

**CALL 911 IMMEDIATELY. Also contact your local Poison Control Centre.**

**General steps:**
1. **Ensure safety** — Do not put yourself at risk; ventilate area if gas/fumes.
2. **Identify the poison** if possible — Save the container/label for paramedics.
3. **Do NOT induce vomiting** unless specifically told to by Poison Control — it can cause more harm.
4. **If swallowed (conscious, alert):**
   • Rinse mouth with water.
   • Give small sips of water (unless advised otherwise).
5. **If on skin:** Remove contaminated clothing; wash skin with soap and water for 20 minutes.
6. **If in eye:** Irrigate with clean water for 10–20 minutes.
7. **If inhaled:** Move to fresh air immediately.
8. **If unconscious or not breathing:** Start CPR and call 911 immediately.
9. **Recovery position** if unconscious but breathing.

**Ethiopia Poison Helpline:** Contact St. Paul's Hospital or Black Lion Hospital.

⚠️ *Keep all medications locked away from children.*`,
    followUps: ['CPR steps', 'Recovery position', 'Signs of shock'],
  },

  // ── Anaphylaxis / Allergic Reaction ────────────────────────────────────
  {
    keywords: ['anaphylax', 'allergic reaction', 'epipen', 'adrenalin', 'epinephrine', 'bee sting', 'swollen throat', 'hives', 'urticaria'],
    response: `🐝 **Anaphylaxis (Severe Allergic Reaction) — WHO First Aid**

**CALL 911 IMMEDIATELY — Anaphylaxis is life-threatening.**

**Signs:** Sudden hives, swelling of face/throat, difficulty breathing, wheezing, rapid pulse, dizziness, pale/clammy skin, collapse.

**Steps:**
1. **Epinephrine (adrenaline) auto-injector (EpiPen):** If available, administer immediately to the outer thigh (can be given through clothing). Note the time.
2. **Lie the person flat** with legs raised (unless difficulty breathing — let them sit up).
3. **Call 911** immediately, even after EpiPen use.
4. **A second EpiPen** can be given 5–15 minutes after the first if no improvement and help is delayed.
5. **CPR** if person loses consciousness and stops breathing.
6. **Antihistamines** are NOT a substitute for epinephrine — they work too slowly.

⚠️ *Even if symptoms improve after EpiPen, always go to the emergency room — a biphasic reaction can occur hours later.*`,
    followUps: ['CPR steps', 'Signs of shock'],
  },

  // ── Diabetic Emergency ───────────────────────────────────────────────────
  {
    keywords: ['diabet', 'hypoglyc', 'low blood sugar', 'insulin shock', 'blood sugar', 'glucose'],
    response: `🍬 **Diabetic Emergency — WHO First Aid**

**Hypoglycaemia (Low Blood Sugar) — most common diabetic emergency:**

**Signs:** Shakiness, sweating, confusion, pale skin, hunger, weakness, rapid heartbeat, irritability.

**If CONSCIOUS and able to swallow:**
1. Give **15–20 g of fast-acting sugar:**
   • 3–4 glucose tablets, OR
   • 150–200 ml regular fruit juice or sugary drink, OR
   • 3–4 teaspoons of sugar.
2. **Wait 15 minutes** and re-check — repeat sugar if still symptomatic.
3. Once improved, give a **small snack** (bread, biscuits).
4. **Call 911** if no improvement after 2 doses or if consciousness deteriorates.

**If UNCONSCIOUS:**
• **Do NOT give anything by mouth** — risk of choking.
• Call 911 immediately.
• Place in **recovery position**.
• Be prepared to start CPR.

**Hyperglycaemia (High Blood Sugar)** — develops slowly over hours/days:
• Signs: excessive thirst, frequent urination, confusion, fruity breath.
• Seek medical care; administer prescribed insulin only if advised by doctor.`,
    followUps: ['Recovery position', 'Signs of shock'],
  },

  // ── Shock ────────────────────────────────────────────────────────────────
  {
    keywords: ['shock', 'pale skin', 'cold clammy', 'rapid weak pulse', 'blood pressure drop', 'hypovolemic'],
    response: `⚡ **Signs of Shock & First Aid — WHO Guidelines**

**CALL 911 IMMEDIATELY — Shock is life-threatening.**

**Recognise shock:**
• Pale, cold, clammy or grey skin
• Rapid, weak pulse
• Rapid, shallow breathing
• Nausea or vomiting
• Dizziness, confusion, or anxiety
• Yawning and sighing

**First aid steps:**
1. **Treat the cause** — control any visible bleeding.
2. **Lay the person flat** — Raise legs 30 cm off the ground (unless head/spine/chest/leg injury suspected).
3. **Keep warm** — Cover with a blanket; do not overheat.
4. **Do NOT give food or water.**
5. **Loosen tight clothing** (collar, belt).
6. **Reassure** them; keep them calm and still.
7. **Monitor** breathing and pulse every few minutes.
8. **Start CPR** if they stop breathing.

**Types:** Hypovolaemic (blood/fluid loss), septic (infection), anaphylactic (allergy), cardiogenic (heart failure), neurogenic (spinal injury).`,
    followUps: ['Controlling severe bleeding', 'CPR steps', 'Recovery position'],
  },

  // ── Recovery Position ─────────────────────────────────────────────────────
  {
    keywords: ['recovery position', 'unconscious breathing', 'lateral position', 'semi-prone'],
    response: `🛌 **Recovery Position — WHO First Aid**

Use for an **unconscious person who is BREATHING** (do not use if spine injury suspected).

**Steps:**
1. Kneel beside the person.
2. Place the **arm nearest to you** at a right angle to their body, elbow bent, palm facing up.
3. Bring their **far arm** across their chest and hold the back of their hand against their near cheek.
4. With your other hand, pull their **far knee** up so the foot is flat on the floor.
5. Keeping their hand pressed against their cheek, **pull on the bent knee** to roll them toward you onto their side.
6. Tilt their **head back slightly** to keep the airway open.
7. Adjust the **top knee** so hip and knee are at right angles.
8. **Monitor breathing** continuously until help arrives.

⚠️ *If breathing stops, roll them onto their back and start CPR immediately.*`,
    followUps: ['CPR steps', 'Signs of shock'],
  },

  // ── Drowning / Near Drowning ─────────────────────────────────────────────
  {
    keywords: ['drown', 'near drown', 'submersion', 'water rescue'],
    response: `🌊 **Drowning First Aid — WHO Guidelines**

**CALL 911 IMMEDIATELY.**

**Rescue safely:**
1. **Do not enter the water** unless you are trained — you risk becoming a victim too.
2. **Throw** something buoyant (life ring, rope, bag, cooler); **reach** with a pole or towel from the edge.

**Once victim is out of water:**
1. **Check responsiveness** — Tap and shout.
2. If **not breathing normally:** Start CPR immediately (begin with 5 rescue breaths, then 30:2).
3. **Do NOT waste time** draining water from lungs — start CPR.
4. **If breathing:** Place in recovery position, keep warm and monitor.
5. Remove wet clothing; cover with dry blanket to prevent hypothermia.
6. **All drowning victims** need hospital evaluation even if they seem OK — secondary drowning can occur hours later.

⚠️ *Even a brief submersion requires medical evaluation.*`,
    followUps: ['CPR steps', 'Recovery position'],
  },

  // ── Head Injury ───────────────────────────────────────────────────────────
  {
    keywords: ['head injury', 'head trauma', 'concussion', 'skull', 'brain injury', 'hit on head'],
    response: `🤕 **Head Injury First Aid — WHO Guidelines**

**CALL 911 for severe head injuries.**

**Signs of serious head injury:** Loss of consciousness, convulsions, persistent vomiting, blood/clear fluid from ears or nose, unequal pupils, severe headache, confusion, weakness/numbness.

**Steps:**
1. **Keep still** — Do not move the person unless in immediate danger; treat as potential spinal injury.
2. **Apply gentle pressure** to any bleeding wound (avoid pressing if skull fracture suspected).
3. **Do NOT remove a helmet** if worn.
4. **Lay flat** carefully if no spinal injury suspected; keep head and neck aligned.
5. **Monitor** consciousness: speak to them, check responses.
6. **Do NOT give painkillers, food, or water** until assessed by a doctor.
7. If they vomit, **log-roll** (keeping head/neck/body aligned) onto their side.

**Concussion monitoring (mild):**
• Rest for 24–48 hours.
• Seek urgent care if: confusion worsens, repeated vomiting, seizure, slurred speech, or worsening headache.`,
    followUps: ['Recovery position', 'CPR steps'],
  },

  // ── Seizures / Epilepsy ───────────────────────────────────────────────────
  {
    keywords: ['seizure', 'epilepsy', 'convulsion', 'fit', 'epileptic'],
    response: `⚡ **Seizures / Convulsions — WHO First Aid**

**CALL 911 if:** First-ever seizure, lasts more than 5 minutes, person doesn't regain consciousness, or injury occurs.

**During a seizure:**
1. **Keep calm** — Most seizures stop on their own within 1–3 minutes.
2. **Clear the area** — Move dangerous objects away; cushion the head.
3. **Do NOT restrain** the person or put anything in their mouth.
4. **Time the seizure** — duration matters for medical decisions.
5. **Loosen tight clothing** around the neck.
6. **Turn on their side** (recovery position) if possible — prevents aspiration.

**After the seizure:**
1. Gently place in **recovery position**.
2. Stay with them — they may be confused (post-ictal phase; can last minutes to hours).
3. Speak calmly and reassuringly.
4. Check for injuries.
5. Do NOT give food or drink until fully conscious.

**Call 911 immediately if:**
• Seizure lasts over 5 minutes.
• Second seizure follows quickly.
• Person does not wake up.
• Injury occurred during seizure.`,
    followUps: ['Recovery position', 'CPR steps'],
  },

  // ── Wound Care / Infection ───────────────────────────────────────────────
  {
    keywords: ['wound care', 'wound clean', 'infect', 'antisept', 'dressing', 'bandage', 'minor cut', 'clean wound'],
    response: `🩹 **Wound Care & Infection Prevention — WHO Guidelines**

**For minor cuts and wounds:**
1. **Wash hands** thoroughly before touching the wound.
2. **Control bleeding** — Apply direct pressure with a clean cloth.
3. **Rinse the wound** under clean running water for at least 5 minutes. Use mild soap around (not in) the wound.
4. **Do NOT** use iodine, hydrogen peroxide, or alcohol directly on the wound — they damage tissue.
5. **Remove visible debris** gently with clean tweezers if safe to do so.
6. **Apply a thin layer** of antibiotic ointment if available.
7. **Cover** with a sterile dressing or clean bandage. Change daily.

**Signs of infection (seek medical care if present):**
• Increasing redness, warmth, or swelling after 24–48 hours.
• Pus or discharge from the wound.
• Red streaks spreading from the wound.
• Fever or chills.
• Wound does not begin healing after a few days.

**Tetanus:** Seek medical advice about tetanus vaccination for deep or dirty wounds.`,
    followUps: ['Controlling severe bleeding', 'Burns first aid'],
  },

  // ── Heatstroke / Heat Exhaustion ──────────────────────────────────────────
  {
    keywords: ['heatstroke', 'heat stroke', 'heat exhaustion', 'overheating', 'heat cramp', 'sunstroke', 'hyperthermia'],
    response: `☀️ **Heatstroke & Heat Exhaustion — WHO First Aid**

**Heatstroke is an emergency — CALL 911 IMMEDIATELY.**

**Distinguish the two:**
| | Heat Exhaustion | Heatstroke |
|---|---|---|
| Skin | Pale, cool, moist | Red, hot, DRY |
| Consciousness | Normal | Confused/unconscious |
| Temperature | Normal or slightly raised | Above 40°C (104°F) |

**Heat Exhaustion (less severe):**
1. Move to a cool, shaded area.
2. Lay down; raise legs slightly.
3. Remove excess clothing.
4. Give cool water to sip if conscious.
5. Apply cool, wet cloths to skin; fan.

**Heatstroke (emergency):**
1. **Call 911 immediately.**
2. Move to cool environment NOW.
3. **Cool rapidly** — immerse in cool water, or apply ice packs to neck, armpits, groin. Fan vigorously.
4. Do NOT give fluids to unconscious person.
5. Place in recovery position if unconscious and breathing.
6. Monitor until emergency services arrive.`,
    followUps: ['Recovery position', 'Signs of shock'],
  },

  // ── Hypothermia / Frostbite ────────────────────────────────────────────────
  {
    keywords: ['hypothermia', 'frostbite', 'cold exposure', 'freezing', 'cold injury', 'frost'],
    response: `🥶 **Hypothermia & Frostbite — WHO First Aid**

**CALL 911 for severe hypothermia or large-area frostbite.**

**Hypothermia (body temp below 35°C / 95°F):**
Signs: Shivering, slurred speech, clumsiness, confusion, drowsiness.
1. Move to a warm, dry place.
2. Remove wet clothing.
3. Warm the person gradually — cover with blankets, warm (not hot) drinks if conscious.
4. Apply warming pads/bottles (wrapped) to armpits, groin, neck.
5. Do NOT rub limbs vigorously or apply direct heat.
6. If unconscious, check breathing and start CPR if needed.

**Frostbite:**
Signs: Cold, numb, white/grey/yellow skin on fingers, toes, ears, nose.
1. Move to a warm environment.
2. Do NOT rub the affected area.
3. Do NOT rewarm if there is risk of refreezing (walking on thawed feet causes more damage).
4. Rewarm in warm (37–40°C) water for 20–30 minutes.
5. Cover with loose, sterile bandage.
6. Do NOT pop blisters.
7. Seek medical care promptly.`,
    followUps: ['Signs of shock', 'Recovery position'],
  },

  // ── Eye Injury ────────────────────────────────────────────────────────────
  {
    keywords: ['eye injury', 'chemical eye', 'eye burn', 'foreign body eye', 'object in eye', 'eye pain', 'vision loss'],
    response: `👁️ **Eye Injury First Aid — WHO Guidelines**

**CALL 911 or go to an emergency department for serious eye injuries.**

**Foreign body in eye (small particle):**
1. Do NOT rub the eye.
2. Blink repeatedly — tears may flush the object out.
3. Gently irrigate with clean water — tilt head, pour water from inner to outer corner.
4. If object is visible on the white, try to gently lift with the corner of a clean cloth — never touch the coloured part.
5. Seek medical care if object cannot be removed or vision is affected.

**Chemical in eye:**
1. Immediately irrigate with clean water for **15–20 minutes** continuously.
2. Remove contact lenses if worn.
3. Do NOT try to neutralise with another chemical.
4. Seek emergency care immediately.

**Penetrating or embedded object:**
1. Do NOT remove the object.
2. Cover both eyes loosely (covering one helps reduce movement of the other).
3. Seek emergency care immediately.

**Blunt trauma (black eye):** Apply a wrapped cold pack for 10–15 minutes. Seek care if: severe pain, vision change, blood in eye, or double vision.`,
    followUps: ['Wound care & infection'],
  },

  // ── Snake Bite ─────────────────────────────────────────────────────────────
  {
    keywords: ['snake', 'snakebite', 'snake bite', 'venom', 'venomous'],
    response: `🐍 **Snakebite First Aid — WHO Guidelines**

**CALL 911 or go to hospital IMMEDIATELY. Antivenom must be given by medical professionals.**

**Steps:**
1. **Move away** from the snake to a safe distance — do NOT try to catch or kill it (note appearance if safe to do so).
2. **Keep the person calm** and still — movement speeds venom spread.
3. **Immobilise the bitten limb** at or below heart level.
4. **Remove** tight clothing, watches, and jewellery near the bite — swelling occurs.
5. **Apply a broad, firm pressure bandage** (NOT a tourniquet) starting at the bite and wrapping up the limb. (Technique applies mainly for neurotoxic snakes; consult local guidance for Ethiopia.)
6. **Do NOT** cut the wound, suck out venom, apply ice, or apply tourniquet.
7. **Do NOT give alcohol** or other substances.
8. Transport urgently to hospital — the priority is antivenom.

**In Ethiopia:** Black Lion Hospital (Addis Ababa) and St. Paul's Hospital have antivenom supplies.`,
    followUps: ['Signs of shock', 'Wound care & infection'],
  },

  // ── Fainting / Syncope ────────────────────────────────────────────────────
  {
    keywords: ['faint', 'syncop', 'pass out', 'collapse', 'dizzy', 'light-headed'],
    response: `😵 **Fainting (Syncope) — WHO First Aid**

**If someone is about to faint:**
1. Help them **sit or lie down** to prevent a fall.
2. Have them **lower their head** between their knees if sitting.

**If someone has fainted:**
1. **Lay them on their back** in a safe position.
2. **Raise their legs** 30 cm (12 inches) above heart level if no injury.
3. **Loosen tight clothing** (collar, belt, bra).
4. **Check breathing** — if not breathing normally, start CPR and call 911.
5. Gently turn on their side if they vomit.
6. Do NOT give food or water until fully conscious.
7. Most people regain consciousness within a minute or two.

**CALL 911 if:**
• Person does not regain consciousness within 1–2 minutes.
• First episode for someone with a known heart condition.
• Accompanied by chest pain, palpitations, or shortness of breath.
• Occurred during exertion.
• Person is pregnant.`,
    followUps: ['Recovery position', 'CPR steps', 'Signs of shock'],
  },

  // ── Asthma Attack ─────────────────────────────────────────────────────────
  {
    keywords: ['asthma', 'inhaler', 'wheez', 'bronchospasm', 'can\'t breathe asthma', 'breathing attack'],
    response: `🫁 **Asthma Attack — WHO First Aid**

**CALL 911 if severe or Blue inhaler isn't helping.**

**Recognise an attack:** Wheezing, shortness of breath, coughing, chest tightness, difficulty speaking in full sentences.

**Steps:**
1. **Sit the person upright** — leaning slightly forward. Do NOT lay them flat.
2. **Stay calm** and reassure them — panic worsens an attack.
3. **Use their reliever inhaler (usually blue):**
   • Shake well; give 1 puff at a time using a spacer if available.
   • Take slow, steady breaths after each puff.
   • Give UP TO 10 puffs, one puff every 30–60 seconds.
4. **Wait 5–10 minutes** — if improving, give 2 more puffs as maintenance.
5. **Call 911** if: no improvement after 10 puffs, too breathless to speak/walk, lips turning blue, or person is exhausted.

**If no inhaler is available:** Keep them upright, calm, focused on slow breaths. Seek emergency care immediately.

⚠️ *Do NOT use a preventer inhaler (usually brown/purple) to relieve an acute attack.*`,
    followUps: ['CPR steps', 'Signs of shock'],
  },

  // ── Spinal Injury ─────────────────────────────────────────────────────────
  {
    keywords: ['spinal', 'spine', 'neck injury', 'back injury', 'paralysis', 'do not move'],
    response: `🦴 **Suspected Spinal Injury — WHO Guidelines**

**CALL 911 IMMEDIATELY. Incorrect movement can cause permanent paralysis.**

**Suspect spinal injury if:**
• High-impact trauma (car crash, fall from height, diving accident).
• Neck or back pain after trauma.
• Tingling, numbness, or weakness in limbs.
• Unconsciousness with unknown cause of injury.

**Steps:**
1. **Do NOT move the person** unless in immediate life-threatening danger (fire, drowning).
2. **Tell them to stay still** — reassure them calmly.
3. **Hold the head still** with both hands — in the position you found it (do NOT try to straighten).
4. **Maintain the airway** — if unconscious but breathing, gently support the jaw.
5. If you MUST move (life threat): log-roll, keeping spine aligned.
6. **If not breathing:** Airway takes priority — tilt head gently only as far as needed to open airway and start CPR.
7. Do NOT remove helmets unless airway is blocked.

⚠️ *Moving a person with a spinal injury incorrectly is a leading cause of preventable paralysis.*`,
    followUps: ['CPR steps', 'Recovery position'],
  },

  // ── Pregnancy Emergency ────────────────────────────────────────────────────
  {
    keywords: ['pregnant', 'pregnancy emergency', 'labour', 'childbirth', 'miscarriage', 'preeclampsia', 'eclampsia'],
    response: `🤰 **Pregnancy Emergency — WHO First Aid**

**CALL 911 IMMEDIATELY for any serious pregnancy emergency.**

**Emergency labour (delivery imminent):**
1. Call 911 and keep them on the line for guidance.
2. Help the mother lie down, knees bent, feet flat.
3. Provide privacy and warmth.
4. **Do NOT try to delay or stop the birth.**
5. If baby arrives before help: support the baby's head gently, never pull; lay baby on mother's abdomen; keep warm; do NOT cut cord unless trained.
6. Encourage breastfeeding after birth to help contract uterus.

**Bleeding in pregnancy:** Lay flat, call 911 immediately; any bleeding in pregnancy is an emergency.

**Preeclampsia signs:** Severe headache, visual disturbances, swelling of face/hands, upper abdominal pain. Seek emergency care immediately.

**Eclampsia (seizures in pregnancy):**
• Protect from injury during seizure.
• Lay on left side after seizure.
• Call 911 immediately.

⚠️ *All pregnancy emergencies require urgent professional care.*`,
    followUps: ['Seizures', 'Controlling severe bleeding'],
  },

  // ── General First Aid Kit ─────────────────────────────────────────────────
  {
    keywords: ['first aid kit', 'what should i have', 'emergency supplies', 'first aid box'],
    response: `🧰 **WHO-Recommended First Aid Kit Contents**

**Basic First Aid Kit (Home/Personal):**
• Sterile dressings (different sizes)
• Bandages (roller and triangular)
• Adhesive plasters/band-aids (assorted sizes)
• Disposable gloves (latex-free)
• Scissors and tweezers
• Safety pins
• Digital thermometer
• Antiseptic wipes or solution
• Antibiotic ointment (e.g., Neosporin)
• Aspirin (300 mg tablets — NOT for under 16s)
• Paracetamol (acetaminophen)
• Oral rehydration salts (ORS)
• Medical tape
• First aid manual or guide
• Emergency contact numbers (911, hospital, family)
• Torch/flashlight with extra batteries
• Mylar emergency blanket
• CPR face shield/mask

**If known medical conditions exist:** Include prescribed medications (e.g., EpiPen for allergy, reliever inhaler for asthma, glucose tablets for diabetes).

💡 *Check and replenish your kit every 6 months.*`,
    followUps: ['What is CPR?', 'Wound care & infection'],
  },

  // ── Emergency contact info ─────────────────────────────────────────────────
  {
    keywords: ['emergency number', 'call ambulance', 'ethiopian emergency', '911', '907', 'contact emergency'],
    response: `📞 **Ethiopian Emergency Numbers**

• **🚑 Ambulance (Erdataya):** Use this app to dispatch immediately
• **🏥 Emergency:** 911
• **🔥 Fire & Rescue:** 939
• **👮 Police:** 991
• **🏥 Black Lion Hospital (Addis Ababa):** +251 111 239 720
• **🏥 St. Paul's Hospital:** +251 111 241 845
• **🧪 Poison Control:** Contact Black Lion or St. Paul's Hospital

**Tip:** If using this app, press the **Help** button on the home screen to dispatch an ambulance directly. The system will share your GPS location automatically.`,
    followUps: ['How to use this app', 'CPR steps'],
  },

  // ── How to use the app ────────────────────────────────────────────────────
  {
    keywords: ['how to use', 'how do i', 'app help', 'use erdataya', 'request ambulance', 'call ambulance app'],
    response: `📱 **How to Use the Erdataya Ambulance App**

1. **Log in** with your phone number and password.
2. **Tap "Help"** on the home screen.
3. Choose **"For me"** (you need help) or **"For other"** (someone near you needs help).
4. The app will capture your **GPS location** automatically.
5. Set the **severity** (low → critical) and describe the situation.
6. Tap **"Call Ambulance"** — a dispatcher will be notified immediately.
7. You'll see real-time updates on the **Emergency Status** screen showing your ambulance ETA.

💡 *Keep your phone screen on while waiting so you can see updates.*`,
    followUps: ['Ethiopian emergency numbers', 'What is CPR?'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fallback responses
// ─────────────────────────────────────────────────────────────────────────────
const FALLBACK_RESPONSES: string[] = [
  `I'm your WHO-based first aid assistant. I can help with topics like **CPR, bleeding, choking, burns, stroke, poisoning, fractures, shock**, and more.

Please describe your situation or choose a topic from the suggestions above.

⚠️ *In a life-threatening emergency, call 911 immediately and do not wait for chatbot guidance.*`,
  `I didn't quite understand that. Here are some topics I can help with:
• CPR and cardiac arrest
• Controlling bleeding
• Choking (Heimlich manoeuvre)
• Burns and scalds
• Stroke recognition (FAST)
• Fractures and sprains
• Poisoning
• Shock

Please type your question, or tap one of the quick topics above.`,
];

let fallbackIndex = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Main response function
// ─────────────────────────────────────────────────────────────────────────────
export function getBotResponse(userInput: string): BotMessage {
  const lower = userInput.toLowerCase().trim();

  // Greetings
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|salam|selam)\b/.test(lower)) {
    return {
      role: 'bot',
      text: `👋 **Hello! I'm your First Aid Assistant, powered by WHO guidelines.**

I can guide you through emergency first aid procedures. Ask me about:
• CPR, choking, severe bleeding
• Burns, fractures, stroke, shock
• Poisoning, allergic reactions, seizures

💡 *For immediate life-threatening emergencies, call 911 first, then use this chatbot for step-by-step guidance.*`,
      followUps: ['How to perform CPR?', 'Signs of a stroke', 'Controlling bleeding'],
    };
  }

  // Thank you
  if (/\b(thank|thanks|thx|appreciated|helpful)\b/.test(lower)) {
    return {
      role: 'bot',
      text: `You're welcome! 🙏 Stay safe. Remember — in a life-threatening emergency, always **call 911** immediately and use this chatbot for step-by-step guidance while help is on the way.

Is there anything else I can help you with?`,
      followUps: ['CPR steps', 'Ethiopian emergency numbers', 'First aid kit'],
    };
  }

  // Emergency trigger words — strong CTA
  if (/\b(dying|dead|no pulse|not breathing|unconscious|emergency|critical|help me)\b/.test(lower)) {
    return {
      role: 'bot',
      text: `🚨 **CALL 911 NOW!**

While waiting for help, you can:
• **Perform CPR** if they are not breathing and have no pulse.
• **Control severe bleeding** with firm direct pressure.
• **Place in recovery position** if unconscious but breathing.

What specific situation are you dealing with?`,
      followUps: ['CPR steps', 'Controlling bleeding', 'Recovery position'],
    };
  }

  // Search the knowledge base
  for (const entry of KB) {
    const matched = entry.keywords.some((kw) => lower.includes(kw));
    if (matched) {
      return {
        role: 'bot',
        text: entry.response,
        followUps: entry.followUps,
      };
    }
  }

  // Fallback
  const fbText = FALLBACK_RESPONSES[fallbackIndex % FALLBACK_RESPONSES.length];
  fallbackIndex += 1;
  return {
    role: 'bot',
    text: fbText,
    followUps: ['CPR steps', 'Controlling bleeding', 'Stroke recognition', 'Ethiopian emergency numbers'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Welcome message shown when chat opens
// ─────────────────────────────────────────────────────────────────────────────
export function getWelcomeMessage(): BotMessage {
  return {
    role: 'bot',
    text: `👋 **Welcome to the Erdataya First Aid Chatbot!**

I provide first aid guidance based on **World Health Organization (WHO)** guidelines and Ethiopian Ministry of Health protocols.

I can help you with:
• 🫀 CPR & Cardiac Arrest
• 🩸 Bleeding Control
• 🫁 Choking & Breathing
• 🔥 Burns & Heat Injuries
• 🧠 Stroke Recognition
• 🦴 Fractures & Injuries
• ⚡ Shock Management
• ☠️ Poisoning

**How to start:** Type your question below, or tap one of the quick topics.

⚠️ *Disclaimer: This chatbot provides general first aid information. It is NOT a substitute for professional medical care. In a life-threatening emergency, CALL 911 immediately.*`,
    followUps: ['How to perform CPR?', 'Signs of a stroke', 'Controlling a nosebleed', 'Emergency contacts'],
  };
}
