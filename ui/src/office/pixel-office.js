'use strict';

window.ModelDeskCreateOffice = function createOffice({ workbenchRoom = document.body?.dataset?.officeProfile === 'workbench',
    dialogParent = document.body, theme = () => undefined, ambientIdle = false } = {}) {
  const scene = window.ModelDeskOfficeScene;
  const desks = workbenchRoom ? scene.LAYOUT.desks3 : scene.LAYOUT.desks4;
  let cleanupRoom;

  const agents = [
    { id: 'codex', name: 'Codex', shortName: 'Codex' },
    { id: 'qoder', name: 'Qoder CN', shortName: 'Qoder CN' },
    { id: 'gemini', name: 'Gemini', shortName: 'Gemini' },
  ];
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const assignable = agents;
  const appearances = {
    gemini: '吉米奈', 'gpt-dragon': '银龙娘', qwen: '千问', hy: 'HY',
    dayu: '大肥鱼', orange: '橘发娘', glm: 'GLM', dounai: '豆奶',
    dragon: '银发', whale: '蓝发', rainbow: '蓝紫发',
  };

  // Character personality lines for click interactions & autonomous AI girl banter!
  const DIALOGUES = {
    gemini: ['喵呜~ 星光算力满格，随时开工✦', '猫耳能听见隐藏 Bug 的声音哦~', '喝口桂花茶再继续写代码吧♪', '院子里的花瓣飘进窗台啦🌸'],
    'gpt-dragon': ['统筹与验收交给我，绝不出错。', '茶凉了的话，我用龙息温热一下…', '先理清边界，再派单会更稳妥✦', '大家今天在木屋里也很默契呢~'],
    dragon: ['方案已经整理好了，随时可以验收。', '壁炉的火光好暖和，灵感满满✦', '看看窗外的云，思路也清晰了~'],
    qwen: ['思路已拆解成步骤，等待指令♪', '窗边微风一吹，好点子就来了~', '这杯青瓷热茶香气刚刚好🍵', '一起把复杂问题拆得清清楚楚！'],
    hy: ['围巾系好，工具就位！随时待命。', '刚泡好的热可可，要来一杯吗？', '庭院里的锦鲤游得好悠闲呀🐟', '交付前的每一步都要细心核对~'],
    dayu: ['咕噜噜~ 蓝鲸画笔正在润色中🎨', '锦鲤好像在向我吐泡泡耶！', '沙发上的蓝鲸抱枕软乎乎的~', '画完这组像素就去吃曲奇🍪'],
    whale: ['蓝色调最让人静下心写代码啦~', '去花园池塘边散散步吧🐟'],
    orange: ['阳光暖洋洋的，元气满满☀', '曲奇出炉啦，大家快来尝尝🍪', '今天也要把工作台收拾得漂漂亮亮！'],
    glm: ['护目镜戴好，高速检索模式启动✦', '发现一处可以顺手优化的小细节！'],
    dounai: ['豆奶能量补充完毕，随时出发~', '小橘猫在壁炉边睡得好香呀♥'],
    rainbow: ['色彩和灵感都像彩虹一样冒出来啦♪', '去廊台上吹吹风找找新创意~'],
  };

  const PAIR_BANTER = [
    ['刚泡好的桂花茶，分你一杯呀🍵', '好香！配着曲奇正合适🍪'],
    ['外面樱花树下的风好舒服🌸', '等这轮任务结束一起去喂锦鲤吧🐟'],
    ['刚才那段代码重构得好利落✦', '嘻嘻，有你帮忙验收超安心！'],
    ['壁炉边的小橘猫又在打呼噜了♥', '嘘~ 别吵醒它，悄悄摸一下就好'],
    ['留声机放的曲子好治愈呀♪', '像星露谷的午后一样悠闲~'],
  ];

  const defaultDesks = [
    { endpoint: 'codex', sprite: 'gpt-dragon' },
    { endpoint: 'qoder', sprite: 'dayu' },
    { endpoint: 'gemini', sprite: 'gemini' },
  ];
  const sceneDefaults = { timeMode: 'auto', weather: 'sakura', hearthLit: true, musicOn: true };
  let deskSettings = defaultDesks;
  let prefs = { ...sceneDefaults };
  let savePreferences = async () => { throw new Error('工作台正在连接'); };
  let reportPreferenceError = () => {};
  let sceneRevision = 0;

  async function saveScenePrefs(key) {
    const revision = ++sceneRevision;
    try {
      const state = await savePreferences({ office_scene: { [key]: prefs[key] } });
      if (revision === sceneRevision) applyPreferences(state.prefs);
    } catch (error) {
      reportPreferenceError(error);
    }
  }

  function applyPreferences(saved) {
    if (saved.office_desks && JSON.stringify(saved.office_desks) !== JSON.stringify(deskSettings)) {
      deskSettings = saved.office_desks;
      flights = [];
      layoutChanged = true;
    }
    const next = { ...sceneDefaults, ...saved.office_scene };
    if (JSON.stringify(prefs) === JSON.stringify(next)) return;
    prefs = next;
    interactive.hearthLit = prefs.hearthLit;
    interactive.musicOn = prefs.musicOn;
    bgPaletteId = '';
    syncToolbarState();
    if (room) updateMotion();
  }
  let endpointsById = new Map(), layoutChanged = false;
  const liveStates = new Set(['running', 'dispatching', 'queued']);
  const attentionCodes = new Set([
    'outcome_unknown', 'cleanup_attention', 'recovery_pending', 'review_unknown',
    'returned', 'blocked', 'failed', 'cancelled', 'unknown', 'integration_conflict',
    'integration_check_failed', 'integration_multiple', 'integration_stale',
    'integration_blocked', 'integration_recovery_required', 'integration_cancelled',
  ]);
  const lamps = { idle: '#7891ad', unavailable: '#5a667d', queued: '#f7c96a', running: '#6de3ad', review: '#baa6ff', attention: '#fa878d', accepted: '#99e68e' };
  const eventStyles = {
    dispatch: { label: '已派单', color: '#f7cb77' }, deliver: { label: '交回待验收', color: '#bcacff' },
    accept: { label: '独立验收通过', color: '#a8e79c' }, return: { label: '退回整改', color: '#fa9296' },
    blocked: { label: '验收受阻', color: '#fa9296' },
    progress: { label: '执行动态', color: '#90dcca' },
  };

  const DEMO_MODES = [
    { id: 'live', label: '演示', full: '真实状态' },
    { id: 'busy', label: '开工中', full: '演示·开工中' },
    { id: 'review', label: '验收中', full: '演示·交接验收' },
    { id: 'attention', label: '待处理', full: '演示·待处理' },
    { id: 'leisure', label: '摸鱼中', full: '演示·悠闲摸鱼' },
  ];
  let demoIndex = 0;

  const tracker = window.ModelDeskOfficeEvents.createTracker(agents.map(agent => agent.id));
  const movement = window.ModelDeskOfficeMotion.create();
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const spriteSheets = {};
  const station = scene.LAYOUT.station;
  const lead = {
    id: 'antigravity', role: 'lead', sprite: 'gemini',
    x: station.x, deskY: station.y, laneX: station.laneX, status: 'idle', shortName: '主模型',
  };

  let room, background, bgPaletteId = '', seats = [], live = false, timer = null;
  let scopeKey, recent = [], flights = [], pendingCount = 0, leadWorkUntil = 0, leadWorking = false, hostLeadPose;
  let actorAction, taskActive = false, awakeUntil = 0, timerDelay = 0, inView = true;
  let lastActors = [], pointer = null, speechTimeout = null;

  function wake() {
    const now = performance.now();
    awakeUntil = now + 2000;
    if (timerDelay !== 65) updateMotion();
  }

  // Interactive runtime state (bubbles, hops, bursts, hover, social chats, props)
  const interactive = {
    hearthLit: prefs.hearthLit,
    musicOn: prefs.musicOn,
    catHappyUntil: 0,
    teaBrewUntil: 0,
    pondRippleUntil: 0,
    treeShakeUntil: 0,
    plushieBounceUntil: 0,
  };
  let hoverTarget = null;
  let speeches = new Map(); // actorId -> { text, emote, until }
  let hops = new Map();     // actorId -> { start, duration }
  let burstParticles = [];
  let nextSocialCheck = 0;
  let socialCooldownUntil = 0;
  let dialogueCursor = 0;
  let toolbarEl = null, actionsEl = null, tickerEl = null;

  function setTicker(text) {
    if (tickerEl && tickerEl.textContent !== text) tickerEl.textContent = text;
  }

  function clearStaticSpeechAt(until) {
    if (!motionPreference.matches) return;
    clearTimeout(speechTimeout);
    const latest = Math.max(until, ...Array.from(speeches.values(), speech => speech.until));
    speechTimeout = setTimeout(updateMotion, Math.ceil(latest - performance.now()) + 1);
  }

  function spawnBurst(x, y, kind, colors, count = 7) {
    if (motionPreference.matches) return;
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const spd = 16 + Math.random() * 24;
      burstParticles.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 6,
        color: colors[i % colors.length],
        kind,
        size: 3,
        start: now + i * 24,
        duration: 760 + Math.random() * 340,
      });
    }
    if (burstParticles.length > 64) burstParticles = burstParticles.slice(-64);
  }

  function triggerHop(actorId, now, duration = 420) {
    if (motionPreference.matches) return;
    hops.set(actorId, { start: now, duration });
  }

  function hopDelta(actorId, now, still) {
    if (still) return 0;
    const hop = hops.get(actorId);
    if (!hop) return 0;
    const p = (now - hop.start) / hop.duration;
    if (p < 0 || p > 1) return 0;
    return Math.round(Math.abs(Math.sin(p * Math.PI * 2)) * 6);
  }

  function pickDialogue(spriteKey) {
    const pool = DIALOGUES[spriteKey] || DIALOGUES.gemini;
    return pool[(dialogueCursor++) % pool.length];
  }

  function actorDisplayName(actor) {
    return appearances[actor.sprite] || actor.shortName || 'AI 娘';
  }

  function currentDemoMode() {
    return DEMO_MODES[demoIndex].id;
  }

  function effectiveActors() {
    const mode = currentDemoMode();
    if (mode === 'live') return { seatsView: seats, leadView: lead };
    const seatsView = seats.map((seat, i) => {
      if (mode === 'busy') return { ...seat, status: i === 2 ? 'queued' : 'running' };
      if (mode === 'review') return { ...seat, status: i === 0 ? 'accepted' : i === 1 ? 'review' : 'running' };
      if (mode === 'attention') return { ...seat, status: i === 1 ? 'attention' : i === 0 ? 'running' : 'idle' };
      return { ...seat, status: 'idle' };
    });
    const leadStatus = mode === 'busy' ? 'running' : mode === 'review' ? 'review' : 'idle';
    return { seatsView, leadView: { ...lead, status: leadStatus } };
  }

  function drawCharacter(ctx, key, { x, foot, seated, frame, flip }, yLift = 0) {
    const sheet = spriteSheets[key];
    const pose = seated ? sheet?.sit : sheet;
    if (!pose?.image.complete || !pose.image.naturalWidth) return;
    const width = Math.round(pose.w * 1.45), height = Math.round(pose.h * 1.45);
    const left = Math.round(x - width / 2), top = Math.round(foot - height - yLift);
    if (flip) {
      ctx.save();
      ctx.translate(left + width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(pose.image, (frame % pose.n) * pose.w, 0, pose.w, pose.h,
      flip ? 0 : left, top, width, height);
    if (flip) ctx.restore();
  }

  function drawWalker(ctx, actor, pose, now, still) {
    const x = Math.round(pose.x), foot = Math.round(pose.foot);
    const lift = hopDelta(actor.id, now, still);
    // Warm elliptical ground shadow
    scene.px(ctx, x - 10, foot - 2, 20, 4, 'rgba(38, 22, 16, 0.28)');
    const playing = !still && !pose.walking && pose.activity === 'ensemble';
    const beat = playing ? Math.max(0, Math.round(Math.sin(now / 190 + pose.x) * 2)) : 0;
    drawCharacter(ctx, actor.sprite, pose, lift + beat);
    if (!pose.walking) drawPastime(ctx, pose, now, still, beat);
    const sprite = spriteSheets[actor.sprite];
    if (actor.role !== 'lead' || !sprite) return;
    // Cute golden crown/star badge above walking Lead!
    const by = foot - Math.round(sprite.h * 1.45) - 9 - lift;
    scene.px(ctx, x - 5, by, 10, 7, '#4a3122');
    scene.px(ctx, x - 4, by + 1, 8, 5, '#ffd76b');
    scene.px(ctx, x - 2, by + 2, 4, 3, '#fff6cc');
  }

  function drawPastime(ctx, pose, now, still, beat) {
    const x = Math.round(pose.x), foot = Math.round(pose.foot);
    const phase = still ? 0.4 : (now / 1400 + x / 64) % 1;
    if (pose.activity === 'ensemble') {
      // A wooden handbell follows the beat. The note rises from its rim.
      const hand = x + 9, y = foot - 21 - beat;
      scene.px(ctx, hand + 2, y - 4, 2, 4, '#5b3e35');
      scene.px(ctx, hand, y, 6, 5, '#e9ac53');
      scene.px(ctx, hand - 1, y + 4, 8, 2, '#ffe48a');
      scene.px(ctx, hand + 2, y + 6, 2, 2, '#654134');
      scene.drawEmoteBubble(ctx, x + 11, foot - 53 - Math.round(phase * 5), 'music', now, still);
    } else if (pose.activity === 'feed' || pose.activity === 'pond') {
      // Toss a pellet from the hand; the koi meets it with a little white splash.
      const startX = x + 4, startY = foot - 23;
      const endX = Math.max(548, Math.min(604, x + 12)), endY = 203;
      scene.px(ctx, x - 7, foot - 22, 8, 6, '#965730');
      scene.px(ctx, x - 6, foot - 22, 6, 2, '#f4d98b');
      if (phase < 0.7) {
        const t = phase / 0.7;
        scene.px(ctx, Math.round(startX + (endX - startX) * t),
          Math.round(startY + (endY - startY) * t - 42 * t * (1 - t)), 3, 2, '#f7ce68');
      } else {
        const radius = 2 + Math.round((phase - 0.7) * 25);
        scene.px(ctx, endX - radius, endY, 3, 1, '#e9fbf3');
        scene.px(ctx, endX + radius, endY, 3, 1, '#e9fbf3');
        scene.px(ctx, endX - 2, endY - 2, 5, 3, '#f28246');
      }
    } else if (pose.activity === 'books') {
      const y = foot - 22;
      scene.px(ctx, x - 9, y, 14, 7, '#693f37');
      scene.px(ctx, x - 8, y - 1, 5, 6, '#ffebc6');
      scene.px(ctx, x - 2, y - 1, 6, 6, '#eac98f');
      scene.px(ctx, x + 2 - Math.floor(phase * 5), y - 2, 2, 6, '#fff6d8');
    }
  }

  function drawFlight(ctx, flight, now, seatsView) {
    const progress = Math.max(0, (now - flight.start) / flight.duration);
    if (progress > 1 || now < flight.start) return;
    const color = eventStyles[flight.kind].color;
    const worker = seatsView.find(seat => seat.id === flight.agent) || agentById.get(flight.agent);
    if (!worker || worker.x === undefined) return;
    const toStation = flight.kind === 'deliver' || flight.kind === 'progress';
    const boss = { x: station.x + 12, y: station.y - 12 };
    const desk = { x: worker.x + 10, y: worker.deskY - 18 };
    const [from, to] = toStation ? [desk, boss] : [boss, desk];
    const x = Math.round(from.x + (to.x - from.x) * progress);
    const y = Math.round(from.y + (to.y - from.y) * progress - 34 * Math.sin(Math.PI * progress));
    if (flight.kind === 'accept') {
      scene.drawEmoteBubble(ctx, station.x, station.y - 28, 'check', now, false);
      return;
    }
    if (progress > 0.78) {
      scene.drawPixelStar(ctx, to.x - 4, to.y - 10, color);
      scene.drawPixelStar(ctx, to.x + 5, to.y - 6, '#fff6cc');
    }
    // Sparkling golden trail
    for (let i = 1; i < 5; i++) {
      scene.px(ctx, x + Math.sign(from.x - to.x) * i * 4, y + 2, 2, 2, color);
    }
    // Cute pixel sealed letter envelope
    scene.px(ctx, x - 6, y - 4, 13, 9, '#4a3122');
    scene.px(ctx, x - 5, y - 3, 11, 7, '#fff7e0');
    scene.px(ctx, x - 4, y - 2, 9, 2, color);
    scene.px(ctx, x - 1, y, 3, 2, '#e05a6d'); // wax seal
  }

  function maybeTriggerSocialInteraction(now, still, actorsWithPoses) {
    if (still || now < nextSocialCheck || now < socialCooldownUntil || movement.interacting()) return;
    nextSocialCheck = now + 2600;
    const idleWalkers = actorsWithPoses.filter(({ actor, pose }) =>
      !pose.seated && (actor.status === 'idle' || actor.status === 'accepted') && !speeches.has(actor.id)
    );
    for (let i = 0; i < idleWalkers.length; i++) {
      for (let j = i + 1; j < idleWalkers.length; j++) {
        const a = idleWalkers[i], b = idleWalkers[j];
        const dist = Math.hypot(a.pose.x - b.pose.x, a.pose.foot - b.pose.foot);
        if (dist < 56 && dist > 10) {
          const dirA = a.pose.x <= b.pose.x ? 'right' : 'left';
          const dirB = dirA === 'right' ? 'left' : 'right';
          movement.pauseActor(a.actor.id, now, 3600, dirA);
          movement.pauseActor(b.actor.id, now, 3600, dirB);
          const pair = PAIR_BANTER[(dialogueCursor++) % PAIR_BANTER.length];
          speeches.set(a.actor.id, { text: pair[0], emote: 'heart', until: now + 3500 });
          speeches.set(b.actor.id, { text: '', emote: 'music', until: now + 3500 });
          triggerHop(a.actor.id, now, 380);
          spawnBurst((a.pose.x + b.pose.x) / 2, Math.min(a.pose.foot, b.pose.foot) - 38, 'heart', ['#ff7aa2', '#ffe066', '#9ce6ff'], 5);
          setTicker(`${actorDisplayName(a.actor)} ⇄ ${actorDisplayName(b.actor)}：「${pair[0]}」「${pair[1]}」`);
          socialCooldownUntil = now + 11000;
          return;
        }
      }
    }
  }

  function paint() {
    if (!room) return;
    const ctx = room.getContext('2d');
    if (!ctx) return;
    const mode = prefs.timeMode === 'auto' ? ({ dark: 'night', light: 'day' }[theme()] || 'auto') : prefs.timeMode;
    const pal = scene.resolvePalette(mode);
    if (!background || bgPaletteId !== pal.id) {
      background = document.createElement('canvas');
      background.width = room.width;
      background.height = room.height;
      scene.buildBackground(background, pal);
      bgPaletteId = pal.id;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(background, 0, 0);

    const now = performance.now();
    const still = room.dataset.motion !== 'active';
    const { seatsView, leadView } = effectiveActors();

    // Clean expired speeches & bursts
    for (const [k, v] of speeches.entries()) if (now >= v.until) speeches.delete(k);
    burstParticles = burstParticles.filter(p => now <= p.start + p.duration);

    // 1. Live animated sky, window clouds/stars, sunlight beams, hearth fire & cat, tea steam, koi pond!
    scene.drawSkyDynamic(ctx, pal, now, still);
    scene.drawSunBeams(ctx, pal);
    scene.drawHearthAndCat(ctx, pal, now, still, interactive);
    scene.drawTeaAndMusicDynamic(ctx, pal, now, still, interactive);
    scene.drawPondDynamic(ctx, pal, now, still, interactive);
    scene.drawBoardNotes(ctx, seatsView, lamps);

    // 2. Compute actor poses & check autonomous AI girl interactions!
    const poses = seatsView.map(seat => movement.pose(seat, now, still));
    const leadPose = movement.pose(leadView, now, still);
    const allActors = [
      ...seatsView.map((actor, i) => ({ actor, pose: poses[i] })),
      { actor: leadView, pose: leadPose },
    ];
    maybeTriggerSocialInteraction(now, still, allActors);

    const walkers = allActors.filter(({ pose }) => !pose.seated).sort((a, b) => a.pose.foot - b.pose.foot);
    const frontOfStation = station.y + 8;
    const frontOfSeats = desks[0].deskY + 8;
    const gesture = !still && flights.find(flight => now >= flight.start && now < flight.start + flight.duration);

    // 3. Y-Depth-Sorted Walkers, Lead Station, & Subordinate Desks!
    for (const { actor, pose } of walkers) if (pose.foot < frontOfStation) drawWalker(ctx, actor, pose, now, still);
    scene.drawLeadStation(ctx, pal, leadView, leadPose, now, still, pendingCount, gesture, eventStyles,
      (c, k, p) => drawCharacter(c, k, p, hopDelta(leadView.id, now, still)));
    for (const { actor, pose } of walkers) if (pose.foot >= frontOfStation && pose.foot < frontOfSeats) drawWalker(ctx, actor, pose, now, still);
    for (const [index, seat] of seatsView.entries()) {
      scene.drawWorkerDesk(ctx, pal, seat, poses[index], now, still, lamps,
        (c, k, p) => drawCharacter(c, k, p, hopDelta(seat.id, now, still)));
    }
    for (const { actor, pose } of walkers) if (pose.foot >= frontOfSeats) drawWalker(ctx, actor, pose, now, still);

    // 4. Swaying Garden Tree Canopy (drawn over upper background & walkers walking behind trunk)
    scene.drawTreeCanopy(ctx, pal, now, still, prefs.weather, interactive);

    // 5. Work-State FX & Leisure Activity Emotes
    for (const { actor, pose } of allActors) {
      const activeSpeech = speeches.get(actor.id);
      if (activeSpeech) {
        const topY = Math.round(pose.foot - (pose.seated ? 38 : 56));
        if (activeSpeech.emote && !activeSpeech.text) {
          scene.drawEmoteBubble(ctx, pose.x + 10, topY + 2, activeSpeech.emote, now, still);
        }
        continue;
      }
      if (actor.role !== 'lead') scene.drawWorkStateFx(ctx, actor, pose, now, still);
      else if (actor.status === 'running' || actor.status === 'review') {
        scene.drawWorkStateFx(ctx, actor, pose, now, still);
      }
      if (!pose.seated) scene.drawLeisureFx(ctx, pose, now, still);
    }

    // 6. Flying Task Delivery / Dispatch Envelopes
    if (!still) for (const flight of flights) drawFlight(ctx, flight, now, seatsView);

    // 7. Weather Particles, Night Glows & Click Burst Particles
    scene.drawWeatherAndGlow(ctx, pal, prefs.weather, now, still, burstParticles);

    // 8. Hover Highlight & Crisp Pixel Speech Dialogues on Top!
    lastActors = allActors.slice().sort((a, b) => b.pose.foot - a.pose.foot);
    if (pointer) updateHover(pointer);
    if (hoverTarget?.box) scene.drawHoverOutline(ctx, hoverTarget.box);
    for (const { actor, pose } of allActors) {
      const sp = speeches.get(actor.id);
      if (sp?.text) {
        const topY = Math.round(pose.foot - (pose.seated ? 40 : 58));
        scene.drawSpeechBanner(ctx, pose.x, topY, sp.text);
      }
    }
  }

  function updateOccupants(now, reset = false) {
    if (currentDemoMode() === 'live') {
      lead.status = hostLeadPose || (leadWorking || now < leadWorkUntil ? 'running' : pendingCount ? 'review' : 'idle');
    }
    const { seatsView, leadView } = effectiveActors();
    movement.update([...seatsView, leadView], now, reset);
  }

  function updateMotion() {
    if (!room) return;
    const panel = room.closest('#pixel-office');
    const visible = !document.hidden && inView && panel && !panel.hidden && (!room.getClientRects || room.getClientRects().length > 0);
    const now = performance.now();
    flights = flights.filter(flight => now <= flight.start + flight.duration);
    if (!hostLeadPose && currentDemoMode() === 'live' && lead.status === 'running' && !leadWorking && now >= leadWorkUntil) updateOccupants(now);
    const busy = taskActive || leadWorking || now < leadWorkUntil || flights.length || now < awakeUntil ||
      demoIndex !== 0 || movement.interacting();
    const animate = visible && !motionPreference.matches && (busy || ambientIdle);
    room.dataset.motion = animate ? 'active' : 'still';
    room.dataset.flight = animate ? flights.find(flight => now >= flight.start)?.kind || '' : '';
    const delay = animate ? (busy ? 65 : 160) : 0;
    if (delay !== timerDelay) {
      if (timer !== null) clearInterval(timer);
      timerDelay = delay;
      timer = delay ? setInterval(updateMotion, delay) : null;
    }
    if (visible) paint();
  }

  // ── Interactive Hit-Testing & Toolbar Controls ──

  function canvasPoint(event) {
    const rect = room.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) * (room.width / rect.width),
      y: (event.clientY - rect.top) * (room.height / rect.height),
    };
  }

  function hitTest(pt) {
    if (!pt) return null;
    // Use the rendered frame. The tabletop hides the lower part of seated sprites.
    for (const { actor, pose } of lastActors) {
      const h = pose.seated ? 38 : 54;
      const w = 34;
      const box = { x: pose.x - w / 2, y: pose.foot - h, w, h: pose.seated ? h - 8 : h };
      if (pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h) {
        return { kind: 'actor', actor, pose, box };
      }
    }
    if (actorAction) {
      for (const {actor, pose} of lastActors) {
        const width = actor.role === 'lead' ? 128 : 74;
        const box = { x: actor.x - width / 2, y: actor.deskY - 7, w: width, h: 26 };
        if (pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h) {
          return { kind: 'desk', actor, pose, box };
        }
      }
    }

    // Check interactive furniture & outdoor garden props!
    for (const [key, prop] of Object.entries(scene.LAYOUT.props)) {
      if (pt.x >= prop.x && pt.x <= prop.x + prop.w && pt.y >= prop.y && pt.y <= prop.y + prop.h) {
        return { kind: 'prop', key, prop, box: prop };
      }
    }
    return null;
  }

  function handleCanvasClick(event) {
    const hit = hitTest(canvasPoint(event));
    if (!hit) return;
    const now = performance.now();
    if (hit.kind === 'desk') {
      actorAction?.(hit.actor.id, hit.actor.position);
      return;
    }
    awakeUntil = now + 5500;
    socialCooldownUntil = now + 6500;

    if (hit.kind === 'actor') {
      const { actor, pose } = hit;
      const name = actorDisplayName(actor);
      const line = pickDialogue(actor.sprite);
      if (!motionPreference.matches) movement.pauseActor(actor.id, now, 4200, 'down');
      triggerHop(actor.id, now, 440);
      speeches.set(actor.id, { text: line, emote: 'heart', until: now + 4200 });
      clearStaticSpeechAt(now + 4200);
      spawnBurst(pose.x, pose.foot - (pose.seated ? 34 : 48), 'heart', ['#ff7aa2', '#ffe066', '#b89cff', '#8ce8ff'], 8);
      setTicker(`${name}：「${line}」`);
      updateMotion();
      if (!ambientIdle && currentDemoMode() === 'live') actorAction?.(actor.id, actor.position);
      return;
    }

    if (hit.kind === 'prop') {
      const { key, prop } = hit;
      if (key === 'hearth') {
        interactive.hearthLit = !interactive.hearthLit;
        prefs.hearthLit = interactive.hearthLit;
        saveScenePrefs('hearthLit');
        if (interactive.hearthLit) spawnBurst(176, 114, 'star', ['#ff9447', '#ffd666', '#fff2b0'], 9);
        setTicker(interactive.hearthLit ? '🔥 壁炉重新燃起了温暖的木柴火光！' : '🪵 熄灭了壁炉火焰，木屋变得安静清爽。');
      } else if (key === 'cat') {
        interactive.catHappyUntil = now + 3200;
        spawnBurst(175, 138, 'heart', ['#ff7aa2', '#ffb870', '#ffe066'], 7);
        setTicker('🐱 摸了摸壁炉边的小橘猫，它开心地呼噜呼噜打起了滚~');
      } else if (key === 'tea') {
        interactive.teaBrewUntil = now + 5200;
        spawnBurst(32, 146, 'star', ['#fff6e0', '#b5e8c3', '#ffd280'], 8);
        summonTeaBreak(now);
      } else if (key === 'music') {
        interactive.musicOn = !interactive.musicOn;
        prefs.musicOn = interactive.musicOn;
        saveScenePrefs('musicOn');
        if (interactive.musicOn) spawnBurst(438, 70, 'star', ['#ffe066', '#ff9ebb', '#9ce6ff'], 7);
        setTicker(interactive.musicOn ? '🎵 复古留声机缓缓响起，木屋里飘起轻松的音符♪' : '🔇 暂停了留声机的旋律。');
      } else if (key === 'pond') {
        interactive.pondRippleUntil = now + 1400;
        spawnBurst(576, 186, 'pixel', ['#b8ecfa', '#ffffff', '#ff9d5c'], 9);
        setTicker('🐟 往庭院锦鲤池撒了一把鱼食，小锦鲤欢快地激起水波！');
      } else if (key === 'tree') {
        interactive.treeShakeUntil = now + 900;
        const cols = prefs.weather === 'sakura' ? ['#ffb8d0', '#ffe4ee', '#ff8fb8'] : ['#78c468', '#a8eb8d', '#ffe066'];
        spawnBurst(568, 86, 'pixel', cols, 14);
        setTicker(prefs.weather === 'sakura' ? '🌸 轻晃庭院樱花树，一阵粉色花瓣随风飘落！' : '🍃 摇了摇庭院大树，阳光透过树叶沙沙作响~');
      } else if (key === 'plushie') {
        interactive.plushieBounceUntil = now + 2600;
        spawnBurst(38, 276, 'heart', ['#6bc5ff', '#a8e6ff', '#ffe066'], 6);
        setTicker('🐳 捏了捏沙发上的大肥鱼蓝鲸抱枕，软乎乎的超解压！');
      } else if (key === 'board') {
        const { seatsView } = effectiveActors();
        const summary = seatsView.map(s => `${s.shortName}:${({ running: '开工', queued: '排队', review: '待验收', attention: '待处理', accepted: '已验收', unavailable: '休息', idle: '空闲' }[s.status] || '空闲')}`).join(' · ');
        setTicker(`📌 工坊公告板：${summary}`);
      }
      updateMotion();
    }
  }

  function summonTeaBreak(now) {
    const { seatsView, leadView } = effectiveActors();
    const ids = [...seatsView, leadView].map(a => a.id);
    const teaSpots = [
      { x: 64, foot: 186, activity: 'tea', pause: 4000, direction: 'left' },
      { x: 96, foot: 196, activity: 'tea', pause: 4000, direction: 'left' },
      { x: 162, foot: 152, activity: 'hearth', pause: 4000, direction: 'up' },
      { x: 192, foot: 156, activity: 'hearth', pause: 4000, direction: 'up' },
    ];
    const moved = movement.summonIdle(ids, teaSpots, now);
    interactive.teaBrewUntil = now + 5500;
    if (moved > 0) {
      setTicker(`☕ 现泡桂花热茶与曲奇！${moved} 位空闲的 AI 娘正走过来喝下午茶~`);
    } else {
      setTicker('☕ 大家正在工位忙着/休息呢，留好热茶和曲奇等她们过来吧~');
    }
  }

  function summonGardenStroll(now) {
    const { seatsView, leadView } = effectiveActors();
    const ids = [...seatsView, leadView].map(a => a.id);
    const gardenSpots = [
      { x: 496, foot: 204, activity: 'porch', pause: 4200, direction: 'right' },
      { x: 546, foot: 242, activity: 'pond', pause: 4400, direction: 'up' },
      { x: 542, foot: 294, activity: 'garden', pause: 4200, direction: 'right' },
      { x: 500, foot: 230, activity: 'porch', pause: 4000, direction: 'right' },
    ];
    const moved = movement.summonIdle(ids, gardenSpots, now);
    if (moved > 0) {
      setTicker(`🌸 打开木门去院子透透气！${moved} 位空闲的 AI 娘正前往木廊和锦鲤池~`);
    } else {
      setTicker('🌸 可以先点「演示·悠闲摸鱼」看大家一起走出木屋逛花园哦！');
    }
  }

  function gatherFor(activity, now) {
    const feeding = activity === 'feed';
    const { seatsView, leadView } = effectiveActors();
    const atLeisure = status => status === 'idle' || status === 'accepted';
    const liveLead = hostLeadPose || (leadWorking || now < leadWorkUntil ? 'running' : pendingCount ? 'review' : 'idle');
    const free = [...seatsView, leadView].filter(actor => atLeisure(actor.status) &&
      atLeisure(actor.role === 'lead' ? liveLead : seats.find(s => s.id === actor.id)?.status));
    if (!free.length) {
      setTicker(feeding ? '鱼食留在池边，等大家忙完再来。' : '手铃已摆好，等大家忙完再来合奏。');
      return;
    }
    if (motionPreference.matches) {
      for (const actor of free) speeches.set(actor.id,{text:'',emote:feeding ? 'fish' : 'music',until:now + 3500});
      clearStaticSpeechAt(now + 3500);
      setTicker(free.length + (feeding ? ' 位伙伴接过了鱼食。' : ' 位伙伴举起手铃应和。'));
      return;
    }
    const places = feeding ? [[544,232],[573,240],[603,232],[518,212]] :
      [[163,228],[209,237],[255,237],[301,228]];
    const spots = places.map(([x,foot]) => ({x,foot,activity,pause:7200,direction:feeding ? 'up' : 'down'}));
    const count = movement.summonIdle(free.map(actor => actor.id),spots,now);
    setTicker(count + (feeding ? ' 位伙伴前往池畔，轮流把鱼食撒给锦鲤。' : ' 位伙伴前往地毯中央，准备摇响手铃。'));
  }

  function greetAll(now) {
    const { seatsView, leadView } = effectiveActors();
    const all = [...seatsView, leadView];
    all.forEach((actor, i) => {
      const pose = movement.pose(actor, now, false);
      triggerHop(actor.id, now + i * 70, 440);
      speeches.set(actor.id, { text: i === 0 ? pickDialogue(actor.sprite) : '', emote: ['heart', 'star', 'music', 'heart'][i % 4], until: now + 3400 });
      spawnBurst(pose.x, pose.foot - (pose.seated ? 34 : 46), i % 2 === 0 ? 'heart' : 'star', ['#ff7aa2', '#ffe066', '#9ce6ff', '#c8a6ff'], 5);
    });
    setTicker('👋 全体 AI 娘开心地向你挥手打招呼啦！');
    clearStaticSpeechAt(now + 3400);
  }

  function cycleDemoMode(now) {
    demoIndex = (demoIndex + 1) % DEMO_MODES.length;
    const mode = DEMO_MODES[demoIndex];
    flights = [];
    if (mode.id === 'review' && !motionPreference.matches) {
      // Trigger lively sample flying handoff envelopes in demo mode!
      const targets = seats.map(s => s.id);
      if (targets[0]) flights.push({ kind: 'accept', agent: targets[0], start: now + 200, duration: 1200 });
      if (targets[1]) flights.push({ kind: 'deliver', agent: targets[1], start: now + 350, duration: 1300 });
      if (targets[2]) flights.push({ kind: 'dispatch', agent: targets[2], start: now + 900, duration: 1300 });
    } else if (mode.id === 'busy' && !motionPreference.matches) {
      seats.forEach((s, idx) => {
        flights.push({ kind: 'dispatch', agent: s.id, start: now + 150 + idx * 280, duration: 1100 });
      });
    }
    updateOccupants(now, false);
    syncToolbarState();
    setTicker(mode.id === 'live'
      ? '✨ 已切回真实工作状态，同步当前项目的实际任务与连接。'
      : `🎬 当前为「${mode.full}」动画预览（不影响真实任务与设置），再次点击可切换。`);
    updateMotion();
  }

  function syncToolbarState() {
    if (!toolbarEl) return;
    toolbarEl.querySelectorAll('[data-office-time]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.officeTime === prefs.timeMode));
    });
    toolbarEl.querySelectorAll('[data-office-weather]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.officeWeather === prefs.weather));
    });
    const demoBtn = actionsEl?.querySelector('[data-office-action="demo"]');
    if (demoBtn) {
      const mode = DEMO_MODES[demoIndex];
      demoBtn.textContent = mode.id === 'live' ? '演示' : `演示·${mode.label}`;
      demoBtn.setAttribute('aria-pressed', String(mode.id !== 'live'));
    }
  }

  function ensureToolbar(canvas) {
    const sceneWrap = canvas.closest('.office-scene');
    if (!sceneWrap || sceneWrap.querySelector('.office-toolbar')) return;
    const bar = document.createElement('div');
    bar.className = 'office-toolbar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '像素工坊互动菜单');
    bar.innerHTML = `
      <div class="office-toolbar-row">
        <div class="office-toolbar-group" role="group" aria-label="时光氛围">
          <button type="button" class="office-pill" data-office-time="auto" aria-pressed="true">自动</button>
          <button type="button" class="office-pill" data-office-time="day" aria-pressed="false">☀ 晴昼</button>
          <button type="button" class="office-pill" data-office-time="dusk" aria-pressed="false">🌇 暮色</button>
          <button type="button" class="office-pill" data-office-time="night" aria-pressed="false">🌙 星夜</button>
        </div>
        <div class="office-toolbar-group" role="group" aria-label="庭院气候">
          <button type="button" class="office-pill" data-office-weather="sakura" aria-pressed="true">🌸 落樱</button>
          <button type="button" class="office-pill" data-office-weather="fireflies" aria-pressed="false">✨ 萤火</button>
          <button type="button" class="office-pill" data-office-weather="rain" aria-pressed="false">🌧 细雨</button>
          <button type="button" class="office-pill" data-office-weather="breeze" aria-pressed="false">🍃 晴风</button>
        </div>
        <div class="office-toolbar-actions">
          <button type="button" class="office-action-btn" data-office-action="tea">喝茶</button>
          <button type="button" class="office-action-btn" data-office-action="garden">逛花园</button>
          <button type="button" class="office-action-btn" data-office-action="feed">喂锦鲤</button>
          <button type="button" class="office-action-btn" data-office-action="ensemble">手铃合奏</button>
          <button type="button" class="office-action-btn" data-office-action="greet">打招呼</button>
          <button type="button" class="office-action-btn office-demo-btn" data-office-action="demo" aria-pressed="false">🎬 演示</button>
        </div>
      </div>
      <p class="office-ticker" aria-live="polite">✨ 点击画面中的 AI 娘、壁炉、小橘猫、茶吧、留声机、锦鲤池或樱花树试试互动吧~</p>
    `;

    bar.addEventListener('click', event => {
      const timeBtn = event.target.closest('[data-office-time]');
      if (timeBtn) {
        prefs.timeMode = timeBtn.dataset.officeTime;
        saveScenePrefs('timeMode');
        bgPaletteId = '';
        syncToolbarState();
        setTicker(`🎨 已切换工坊时光：${timeBtn.textContent.trim()}`);
        updateMotion();
        return;
      }
      const weatherBtn = event.target.closest('[data-office-weather]');
      if (weatherBtn) {
        prefs.weather = weatherBtn.dataset.officeWeather;
        saveScenePrefs('weather');
        syncToolbarState();
        setTicker(`🌤 已切换庭院气候：${weatherBtn.textContent.trim()}`);
        updateMotion();
        return;
      }
    });
    actionsEl = bar.querySelector('.office-toolbar-actions');
    actionsEl.addEventListener('click', event => {
      const actionBtn = event.target.closest('[data-office-action]');
      if (actionBtn) {
        const now = performance.now();
        awakeUntil = now + 5500;
        socialCooldownUntil = now + 6500;
        const act = actionBtn.dataset.officeAction;
        if (act === 'tea') summonTeaBreak(now);
        else if (act === 'garden') summonGardenStroll(now);
        else if (act === 'feed' || act === 'ensemble') gatherFor(act, now);
        else if (act === 'greet') greetAll(now);
        else if (act === 'demo') cycleDemoMode(now);
        updateMotion();
      }
    });

    (sceneWrap.querySelector('#scene-tools') || sceneWrap).append(bar);
    toolbarEl = bar;
    tickerEl = bar.querySelector('.office-ticker');
    const controls = sceneWrap.querySelector('.mdw-interactions');
    if (controls) {
      controls.append(actionsEl, tickerEl);
      setTicker('点角色打招呼，点工位查看任务。');
    }
    syncToolbarState();
  }

  function updateHover(point) {
    const hit = hitTest(point);
    hoverTarget = hit;
    const title = hit?.kind === 'actor' ? (ambientIdle ? '与' + actorDisplayName(hit.actor) + '打招呼' : '查看 ' + actorDisplayName(hit.actor) + ' 工位') :
      hit?.kind === 'desk' ? '查看 ' + actorDisplayName(hit.actor) + ' 工位' :
      hit?.kind === 'prop' ? hit.prop.label + ' · ' + hit.prop.hint : '';
    if (room.title !== title) room.title = title;
    room.style.cursor = hit ? 'pointer' : '';
  }

  function prepareRoom(canvas) {
    room = canvas;
    const roomWrap = canvas.closest('.office-room');
    if (roomWrap) roomWrap.dataset.officeLayout = workbenchRoom ? '3' : '4';

    for (const [key, sheet] of Object.entries(window.ModelDeskOfficeSprites || {})) {
      const image = new Image();
      const seated = new Image();
      image.onload = seated.onload = updateMotion;
      spriteSheets[key] = { ...sheet, image, sit: { ...sheet.sit, image: seated } };
      image.src = sheet.src;
      seated.src = sheet.sit.src;
    }

    canvas.addEventListener('pointermove', event => {
      pointer = canvasPoint(event);
      updateHover(pointer);
      if (room.dataset.motion !== 'active') paint();
    });
    canvas.addEventListener('pointerleave', () => {
      pointer = null;
      updateHover(null);
      if (room.dataset.motion !== 'active') paint();
    });
    canvas.addEventListener('click', handleCanvasClick);
    const viewport = ambientIdle && typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      inView = entries[entries.length - 1].isIntersecting;
      updateMotion();
    }) : null;
    viewport?.observe(canvas);

    // Watch UI theme attribute changes so 'auto' lighting updates immediately!
    const themeObserver = new MutationObserver(() => {
      if (prefs.timeMode === 'auto') {
        bgPaletteId = '';
        updateMotion();
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    ensureToolbar(canvas);

    const motionChanged = () => {
      if (motionPreference.matches) {
        flights = [];
        burstParticles = [];
        speeches.clear();
        updateOccupants(performance.now(), true);
      }
      updateMotion();
    };
    const visibilityChanged = () => {
      if (document.hidden) awakeUntil = 0;
      updateMotion();
    };
    motionPreference.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    cleanupRoom = () => {
      viewport?.disconnect();
      clearTimeout(speechTimeout);
      themeObserver.disconnect();
      motionPreference.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
      for (const sheet of Object.values(spriteSheets)) sheet.image.onload = sheet.sit.image.onload = null;
      if (timer !== null) clearInterval(timer);
      room = null;
    };
  }

  function hide() {
    tracker.reset();
    scopeKey = undefined;
    recent = [];
    flights = [];
    leadWorkUntil = 0;
    pendingCount = 0;
    live = false;
    taskActive = false;
    leadWorking = false;
    hostLeadPose = undefined;
    awakeUntil = 0;
    updateMotion();
  }

  function taskState(task, summary, accepted) {
    const label = summary?.label;
    if (attentionCodes.has(summary?.code)) return ['attention', label];
    if (task.status === 'running') return ['running', label || '正在执行'];
    if (task.status === 'dispatching') return ['queued', label || '正在准备执行'];
    if (task.status === 'queued') return ['queued', label || '等待执行'];
    if (summary?.code === 'integration_accepted') return ['accepted', label];
    if (summary?.code?.startsWith('integration_')) return ['review', label];
    if (accepted(task)) return ['accepted', label || '已独立验收'];
    if (!summary && task.review?.state === 'returned') return ['attention', '需要整改'];
    if (!summary && task.review?.state === 'blocked') return ['attention', '需要处理'];
    if (task.status === 'completed') return ['review', label || '等待独立验收'];
    return ['attention', label || ({ failed: '执行未成功', cancelled: '已停止', recovery_pending: '等待恢复核对' }[task.status] || '状态待核对')];
  }

  function endpointState(endpoint) {
    if (endpoint?.ready === false) return ['unavailable', '执行端未就绪'];
    if (endpoint?.ready === null) return ['queued', '正在探测'];
    return null;
  }

  function awaitingReview(task, summary, accepted) {
    if (task.status !== 'completed') return false;
    const status = summary(task);
    if (status) return status.code === 'awaiting_review';
    return !accepted(task) && !['returned', 'blocked', 'unreadable', 'accepted', 'final_accepted'].includes(task.review?.state) &&
      !['attention', 'pending'].includes(task.controller_finalization?.state) && task[task.engine]?.outcome_unknown !== true;
  }

  function render(args) {
    const {
      canvas, tasks, observedAt, snapshotStartedAt, endpoints, sync, complete, summary, accepted,
      projectName, escapeText, roomScope = 'global', compact = false, deskStatus,
      leadName = 'Antigravity · 派单与验收', leadActive = false, hostLead, hostSeats = {}, onActor,
    } = args;
    actorAction = onActor;
    leadWorking = leadActive;
    hostLeadPose = hostLead;
    endpointsById = new Map((endpoints || []).map(endpoint => [endpoint.id, endpoint]));
    const visible = sync === 'loading' ? [] : tasks;
    taskActive = visible.some(task => liveStates.has(task.status)) || Object.values(hostSeats).some(status => status === 'running');
    const effectiveSync = document.hidden ? 'offline' : sync;
    const key = roomScope;
    const reset = key !== scopeKey || !live || effectiveSync !== 'ready';
    if (reset) {
      recent = [];
      if (currentDemoMode() === 'live') flights = [];
      leadWorkUntil = 0;
    }
    scopeKey = key;
    const events = complete === false && effectiveSync === 'ready' ? [] :
      tracker.observe({ tasks: visible, scopeKey, sync: effectiveSync, observedAt, snapshotStartedAt, summary, accepted });
    const taskIds = new Set(visible.map(task => task.id));
    recent = [...events.slice().reverse(), ...recent.filter(event => taskIds.has(event.id))].slice(0, 6);
    const now = performance.now();
    if (events.some(event => event.kind !== 'progress')) leadWorkUntil = now + 9500;
    if (!motionPreference.matches && currentDemoMode() === 'live') {
      const start = Math.max(now, (flights.at(-1)?.start ?? now - 210) + 210);
      flights = [...flights.filter(flight => flight.start + flight.duration >= now), ...events.filter(event => event.kind !== 'blocked').slice(-6).map((event, index) => ({
        kind: event.kind, agent: event.agent, start: start + index * 210, duration: event.kind === 'accept' ? 850 : 1000,
      }))].slice(-8);
      for (const ev of events) {
        if (ev.kind === 'accept') {
          const worker = seats.find(s => s.id === ev.agent);
          if (worker) {
            triggerHop(worker.id, now, 460);
            spawnBurst(worker.x, worker.deskY - 36, 'star', ['#a8e79c', '#ffe066', '#ffffff'], 10);
          }
        }
      }
    }
    const labels = [];
    seats = [];
    const describeProject = task => task.project_name || (task.project ? projectName(task.project) : '未绑定项目');
    const projectMarkup = task => `<small class="office-task-project">${escapeText(describeProject(task))}</small>`;
    const waiting = visible.filter(task => awaitingReview(task, summary, accepted));
    const assigned = deskSettings.map(({ endpoint, sprite }, i) =>
      ({ ...agentById.get(endpoint), ...desks[i], endpoint, sprite }));
    const assignedIds = new Set(assigned.map(agent => agent.id));
    const extras = new Map();
    for (const task of visible) {
      if (agentById.has(task.engine) || extras.has(task.engine)) continue;
      const endpoint = endpointsById.get(task.engine);
      extras.set(task.engine, { id: task.engine, name: endpoint?.name || task.engine, shortName: task.engine });
    }
    const cards = [...assigned, ...agents.filter(agent => !assignedIds.has(agent.id)), ...extras.values()].map(agent => {
      const { id, name, shortName } = agent;
      const records = visible.filter(task => task.engine === id);
      if (!agent.position && records.length === 0) return '';
      const active = records.filter(task => liveStates.has(task.status));
      const reviews = waiting.filter(task => task.engine === id);
      const task = active.find(task => task.status === 'running') ||
        active.find(task => task.status === 'dispatching') || active[0] || reviews[0] || records[0];
      const endpoint = endpointsById.get(id);
      const currentEndpoint = sync === 'ready' ? endpointState(endpoint) : null;
      const idleLabel = sync === 'loading' ? '等待同步' : sync === 'offline' ? '状态待同步' : '空闲';
      const [status, label] = task ? taskState(task, summary(task), accepted) :
        currentEndpoint || ['idle', idleLabel];
      if (agent.position) {
        seats.push({ ...agent, status: hostSeats[id] || status });
        const workbenchLabel = sync === 'ready' ? deskStatus?.(id) : null;
        const labelText = `<span>${escapeText(shortName)}</span><span class="office-room-label-state">${escapeText(workbenchLabel || label)}</span>`;
        const labelMarkup = deskStatus ? `<button type="button" class="office-room-label"
          data-office-endpoint="${escapeText(id)}" data-office-title="${escapeText(shortName)}"
          data-office-state="${escapeText(status)}"
          aria-haspopup="dialog" title="${escapeText(workbenchLabel || label)}">${labelText}</button>` :
          task ? `<button type="button" class="office-room-label"
          data-office-room-task="${escapeText(task.id)}" data-office-state="${escapeText(status)}"
          title="${escapeText(`${describeProject(task)} · ${task.title || task.id}`)}">
          ${labelText}${compact ? '' : `<strong>${escapeText(describeProject(task))}</strong><strong>${escapeText(task.title || task.id)}</strong>`}</button>` :
          `<div class="office-room-label" data-office-state="${escapeText(status)}">${labelText}</div>`;
        labels.push(`<div class="office-room-seat" data-office-position="${agent.position}">${labelMarkup}
          <button type="button" class="office-settings-button" data-office-settings="${agent.position}"
            aria-label="设置${escapeText(shortName)}工位" aria-haspopup="dialog">设置</button></div>`);
      }
      const pending = [...active, ...reviews];
      const count = pending.length > 1 ? `<span class="office-count">${pending.length} 项未结束</span>` : '';
      const otherTasks = pending.filter(row => row !== task);
      const queue = otherTasks.map(row => {
        const [, rowLabel] = taskState(row, summary(row), accepted);
        return `<li><button type="button" data-office-task="${escapeText(row.id)}"><span>${escapeText(rowLabel)}</span>
          <strong>${escapeText(row.title || row.id)}</strong>${projectMarkup(row)}</button></li>`;
      }).join('');
      return `<article class="office-desk" data-office-agent="${escapeText(id)}" data-office-state="${status}">
        <div class="office-desk-info"><div class="office-desk-head"><h3>${escapeText(name)}</h3>${count}</div>
          <p class="office-state"><i aria-hidden="true"></i>${escapeText(label)}</p>
          ${task ? `<button type="button" class="office-task" data-office-task="${escapeText(task.id)}"><span><span class="office-task-title">${escapeText(task.title || task.id)}</span>${projectMarkup(task)}</span><span aria-hidden="true">↗</span></button>` : ''}
          ${queue ? `<ul class="office-seat-queue" aria-label="其他未结束任务">${queue}</ul>` : ''}
          ${task && currentEndpoint?.[0] === 'unavailable' ? `<small>${escapeText(currentEndpoint[1])}</small>` : ''}
        </div>
      </article>`;
    }).join('');
    pendingCount = waiting.length;
    labels.push(`<div class="office-station-name">${escapeText(leadName)}</div>`);
    const taskButton = (task, text) => `<button type="button" data-office-review-task="${escapeText(task.id)}">${text}</button>`;
    const titleMarkup = task => `<span><span class="office-task-title">${escapeText(task.title || task.id)}</span>${projectMarkup(task)}</span>`;
    const pending = waiting.map(task => `<li>${taskButton(task, titleMarkup(task))}</li>`).join('');
    const kindLabel = event => {
      if (event.kind !== 'dispatch') return eventStyles[event.kind].label;
      if (event.task.source === 'codex' || event.task.owner_host === 'codex') return 'Codex 派单';
      if (event.task.owner_host === 'dsh') return 'DSH 派单';
      if (event.task.source === 'panel') return '工作台派单';
      return eventStyles.dispatch.label;
    };
    const observed = recent.map(event => `<li>${taskButton(event, `<span class="office-event-kind">${kindLabel(event)}</span> ${titleMarkup(event.task)}`)}</li>`).join('');
    const stationMarkup = `<section><h3>主模型验收台 <span class="office-station-count">${pendingCount}</span></h3>
      ${pending ? `<ul>${pending}</ul>` : '<p>暂无待独立验收的交付</p>'}</section>
      <section><h3>跨项目交接</h3>${observed ? `<ul>${observed}</ul>` : '<p>暂无新交接</p>'}</section>`;
    if (!room) prepareRoom(canvas);
    live = effectiveSync === 'ready';
    updateOccupants(now, reset || layoutChanged || !live || motionPreference.matches);
    layoutChanged = false;
    updateMotion();
    return { cards, labels: labels.join(''), station: stationMarkup, seatedEndpoints: [...assignedIds] };
  }

  function openSettings(position, onSave) {
    const index = desks.findIndex(desk => desk.position === position);
    if (index === -1) return;
    const saved = deskSettings[index];
    const dialog = document.createElement('dialog');
    dialog.className = 'office-settings-dialog';
    dialog.setAttribute('aria-labelledby', 'office-settings-title');
    dialog.innerHTML = `<form>
      <header><h2 id="office-settings-title">工位 ${index + 1} 设置</h2>
        <p class="office-settings-hint">执行端决定这个工位显示的任务。选中已入座的执行端时，两个执行端会交换工位。</p></header>
      <label>执行端<select name="endpoint" required autofocus></select></label>
      <label>员工外貌<select name="sprite" required></select></label>
      <div class="office-settings-preview"><canvas width="72" height="68" aria-hidden="true"></canvas></div>
      <footer class="office-settings-actions"><button type="button" class="button secondary">取消</button>
        <button type="submit" class="button">保存</button></footer></form>`;
    const form = dialog.querySelector('form');
    const endpoint = form.elements.namedItem('endpoint');
    const sprite = form.elements.namedItem('sprite');
    for (const agent of assignable) {
      const status = endpointsById.get(agent.id);
      const occupied = deskSettings.findIndex(desk => desk.endpoint === agent.id);
      const suffix = status?.enabled === false ? ' · 已停用' : status?.ready === false ? ' · 未就绪' : '';
      endpoint.add(new Option(`${agent.name}${suffix}${occupied >= 0 && occupied !== index ? ` · 工位 ${occupied + 1}` : ''}`, agent.id));
    }
    for (const [key, label] of Object.entries(appearances)) sprite.add(new Option(label, key));
    endpoint.value = saved.endpoint;
    sprite.value = saved.sprite;
    const preview = dialog.querySelector('canvas').getContext('2d');
    let pendingPreviewImage;
    function paintPreview() {
      if (!preview) return;
      pendingPreviewImage?.removeEventListener('load', paintPreview);
      const image = spriteSheets[sprite.value]?.image;
      pendingPreviewImage = image?.complete ? null : image;
      pendingPreviewImage?.addEventListener('load', paintPreview, { once: true });
      preview.clearRect(0, 0, 72, 68);
      preview.imageSmoothingEnabled = false;
      drawCharacter(preview, sprite.value, { x: 36, foot: 63, seated: false, frame: 0, flip: false });
    }
    sprite.addEventListener('change', paintPreview);
    dialog.querySelector('button[type=button]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      pendingPreviewImage?.removeEventListener('load', paintPreview);
      dialog.remove();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const other = deskSettings.findIndex(desk => desk.endpoint === endpoint.value);
      const next = deskSettings.map((desk, i) => i === index ? { endpoint: endpoint.value, sprite: sprite.value } :
        i === other ? { ...desk, endpoint: saved.endpoint } : desk);
      const submit = form.querySelector('button[type=submit]');
      submit.disabled = true;
      try {
        const state = await savePreferences({ office_desks: next });
        applyPreferences(state.prefs);
        dialog.close();
        onSave(true);
      } catch (error) {
        reportPreferenceError(error);
        submit.disabled = false;
      }
    });
    dialogParent.append(dialog);
    dialog.showModal();
    paintPreview();
  }

  return {
    render, hide, wake, openSettings, applyPreferences,
    destroy() { cleanupRoom?.(); },
    configurePersistence(save, report) { savePreferences = save; reportPreferenceError = report; },
  };
};
window.ModelDeskPixelOffice = window.ModelDeskCreateOffice();
