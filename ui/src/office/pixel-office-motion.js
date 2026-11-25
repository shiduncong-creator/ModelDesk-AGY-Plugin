(function () {
  'use strict';

  const deskStates = new Set(['queued', 'running', 'review', 'unavailable']);
  const frameOffset = { down: 0, right: 4, left: 4, up: 8 };
  const walkSpeed = 58;
  const returnSpeed = 94;
  const stepMs = 114;

  // Doorway bridge connecting cottage interior (x <= 448) and outdoor porch/garden (x >= 488).
  const DOOR_IN = { x: 442, foot: 212 };
  const DOOR_OUT = { x: 494, foot: 212 };
  const UPPER_Y = 146;
  const MID_Y = 232;
  const HALL_Y = 320;

  const INDOOR_STOPS = [
    { x: 88, foot: 140, activity: 'window', pause: 2600, direction: 'up', zone: 'upper' },
    { x: 176, foot: 152, activity: 'hearth', pause: 2700, direction: 'up', zone: 'upper' },
    { x: 64, foot: 186, activity: 'tea', pause: 2500, direction: 'left', zone: 'mid' },
    { x: 374, foot: 140, activity: 'window', pause: 2500, direction: 'up', zone: 'upper' },
    { x: 432, foot: 144, activity: 'books', pause: 2300, direction: 'up', zone: 'upper' },
  ];

  const OUTDOOR_STOPS = [
    { x: 496, foot: 204, activity: 'porch', pause: 2500, direction: 'right', zone: 'outdoor' },
    { x: 546, foot: 242, activity: 'pond', pause: 2800, direction: 'up', zone: 'outdoor' },
    { x: 542, foot: 294, activity: 'garden', pause: 2700, direction: 'right', zone: 'outdoor' },
  ];

  function seatLayout(seat, index) {
    const lead = seat.role === 'lead';
    const deskY = seat.deskY ?? (lead ? 186 : 278);
    const lane = seat.laneX ?? (lead ? 182 : Math.min(444, seat.x + 66));
    const chair = seat.x - (lead ? 0 : 9);
    const corridorFoot = lead ? UPPER_Y : MID_Y + (index % 2) * 4;
    const hallFoot = lead ? MID_Y : HALL_Y + (index % 2) * 4;
    const indoorPick = INDOOR_STOPS[index % INDOOR_STOPS.length];
    const indoorPick2 = INDOOR_STOPS[(index + 2) % INDOOR_STOPS.length];
    const outdoorPick = OUTDOOR_STOPS[index % OUTDOOR_STOPS.length];

    return {
      lead,
      desk: { x: chair, foot: deskY },
      approach: { x: chair, foot: corridorFoot },
      corridor: { x: lane, foot: corridorFoot },
      hall: { x: lane, foot: hallFoot },
      alert: { x: lane, foot: deskY + 12 },
      deskPause: lead ? 600 : 0,
      firstPause: lead ? 420 : 900 + index * 620,
      stops: lead
        ? [INDOOR_STOPS[1], OUTDOOR_STOPS[0], INDOOR_STOPS[2], OUTDOOR_STOPS[1]]
        : [indoorPick, outdoorPick, indoorPick2],
    };
  }

  function modeOf(status) {
    if (deskStates.has(status)) return 'desk';
    return status === 'attention' ? 'attention' : 'idle';
  }

  function standing(point, activity = 'idle', direction = 'down') {
    return {
      x: point.x, foot: point.foot, seated: false, walking: false,
      frame: frameOffset[direction] ?? 0, flip: direction === 'left', direction, activity,
    };
  }

  function seated(point, frame = 0) {
    return { ...standing(point, 'desk'), seated: true, frame };
  }

  function makeRoute(origin, stops, speed, initialPhase = 0) {
    const steps = [];
    let elapsed = 0;
    let walk = initialPhase;
    let from = origin;
    for (const stop of stops) {
      const dx = stop.x - from.x;
      const dy = stop.foot - from.foot;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const direction = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        const duration = Math.hypot(dx, dy) * 1000 / speed;
        steps.push({ from, to: stop, dx, dy, direction, start: elapsed, duration, walk });
        elapsed += duration;
        walk += duration;
      }
      if (stop.pause) {
        steps.push({ to: stop, start: elapsed, duration: stop.pause });
        elapsed += stop.pause;
      }
      from = stop;
    }
    return { steps, duration: elapsed };
  }

  function routePose(route, elapsed, activity) {
    const step = route?.steps.find(item => elapsed < item.start + item.duration);
    if (!step) return null;
    const { from, to, dx, dy, start, duration, direction } = step;
    if (!from) return to.seated ? seated(to) : standing(to, to.activity || activity, to.direction || 'down');
    const progress = Math.max(0, (elapsed - start) / duration);
    return {
      x: from.x + dx * progress,
      foot: from.foot + dy * progress,
      seated: false,
      walking: true,
      frame: frameOffset[direction] + Math.floor((elapsed - start + step.walk) / stepMs) % 4,
      flip: direction === 'left',
      direction,
      activity,
    };
  }

  // Safely route between any two points while respecting the cottage wall & open doorway!
  function safeBridge(from, target, layout) {
    const { desk, approach, corridor, hall } = layout;
    const path = [];
    let cur = { x: from.x, foot: from.foot };

    // 1. If leaving a desk chair, step smoothly backward to approach aisle first.
    const leavingChair = Math.abs(cur.x - desk.x) < 2 && cur.foot > approach.foot && cur.foot <= desk.foot + 2;
    if (leavingChair) {
      path.push(approach, corridor);
      cur = corridor;
    }

    const fromOutdoor = cur.x > 466;
    const toOutdoor = target.x > 466;

    // 2. Exiting garden -> indoors via open wooden doorway!
    if (fromOutdoor && !toOutdoor) {
      if (cur.x > 522) path.push({ x: 522, foot: cur.foot });
      path.push({ x: 522, foot: DOOR_OUT.foot }, DOOR_OUT, DOOR_IN, { x: DOOR_IN.x, foot: MID_Y });
      cur = { x: DOOR_IN.x, foot: MID_Y };
    }

    // 3. Entering garden -> outdoors via open wooden doorway!
    if (!fromOutdoor && toOutdoor) {
      const curAisleY = cur.foot < 176 ? UPPER_Y : cur.foot > 272 ? HALL_Y : MID_Y;
      path.push({ x: cur.x, foot: curAisleY });
      if (curAisleY !== MID_Y) {
        const lane = curAisleY === UPPER_Y && cur.x > 320 ? 442 : corridor.x;
        path.push({ x: lane, foot: curAisleY }, { x: lane, foot: MID_Y });
      }
      path.push({ x: DOOR_IN.x, foot: MID_Y }, DOOR_IN, DOOR_OUT);
      cur = DOOR_OUT;
      if (target.x > 522) {
        path.push({ x: 522, foot: DOOR_OUT.foot }, { x: 522, foot: target.foot });
      } else {
        path.push({ x: target.x, foot: DOOR_OUT.foot });
      }
      path.push(target);
      return path;
    }

    // 4. Both outdoors
    if (fromOutdoor && toOutdoor) {
      path.push({ x: 522, foot: cur.foot }, { x: 522, foot: target.foot }, target);
      return path;
    }

    // 5. Both indoors: route along clear horizontal aisles (UPPER_Y / MID_Y / HALL_Y) & vertical lane!
    const curY = cur.foot < 176 ? UPPER_Y : cur.foot > 272 ? HALL_Y : MID_Y;
    const dstY = target.foot < 176 ? UPPER_Y : target.foot > 272 ? HALL_Y : MID_Y;
    if (Math.abs(cur.foot - curY) > 1) path.push({ x: cur.x, foot: curY });
    if (curY !== dstY) {
      const laneX = corridor.x;
      path.push({ x: laneX, foot: curY }, { x: laneX, foot: dstY });
    }
    path.push({ x: target.x, foot: dstY }, target);
    return path;
  }

  function transition(from, mode, layout) {
    const { desk, hall, approach, alert } = layout;
    let stops;
    if (mode === 'desk') {
      const atChair = Math.abs(from.x - desk.x) < 2 && from.foot >= approach.foot && from.foot <= desk.foot + 2;
      stops = atChair ? [desk] : [...safeBridge(from, approach, layout), desk];
    } else if (mode === 'attention') {
      stops = safeBridge(from, alert, layout);
    } else {
      stops = safeBridge(from, hall, layout);
      if (from.seated && layout.deskPause) stops.unshift({ ...desk, seated: true, pause: layout.deskPause });
    }
    const phase = from.walking ? (from.frame % 4) * stepMs : 0;
    return makeRoute(from, stops, mode === 'idle' ? walkSpeed : returnSpeed, phase);
  }

  function leisureRoute(layout) {
    const { hall, approach, desk, deskPause, firstPause, stops } = layout;
    const path = [{ ...hall, pause: firstPause }];
    let cur = hall;
    for (const stop of stops) {
      path.push(...safeBridge(cur, stop, layout));
      cur = stop;
    }
    path.push(...safeBridge(cur, hall, layout));
    if (deskPause) {
      path.push(...safeBridge(hall, approach, layout), { ...desk, seated: true, pause: 2600 }, approach, ...safeBridge(approach, hall, layout));
    }
    return makeRoute(hall, path, walkSpeed);
  }

  function finishInteraction(actor, now) {
    const action = actor.override;
    if (!action) return;
    if (action.kind === 'pause') {
      if (now < action.until) return;
      const elapsed = action.until - action.since;
      actor.since += elapsed;
      actor.override = action.resume;
      if (actor.override) actor.override.since += elapsed;
    }
    const trip = actor.override;
    if (trip && now >= trip.since + trip.route.duration) {
      // Summons return to the hall, which is also the start of the idle route.
      actor.since = trip.since + trip.route.duration;
      actor.route = null;
      actor.override = null;
    }
  }

  function currentPose(actor, now, still) {
    finishInteraction(actor, now);
    const { mode, layout, status, since, route, leisure, override } = actor;

    // Interactive pause / summon override (e.g., user clicked AI girl or called everyone for tea!)
    if (!still && override) {
      if (override.kind === 'pause' && now < override.until) {
        return override.pose;
      }
      if (override.kind === 'summon') {
        const el = Math.max(0, now - override.since);
        const p = routePose(override.route, el, override.activity || 'tea');
        if (p) return p;
      }
    }

    const elapsed = Math.max(0, now - since);
    if (!still) {
      const walking = routePose(route, elapsed, mode === 'idle' ? 'walking' : 'returning');
      if (walking) return walking;
      if (mode === 'idle') {
        const phase = (elapsed - (route?.duration || 0)) % Math.max(1, leisure.duration);
        return routePose(leisure, phase, 'walking');
      }
    }
    if (mode === 'attention') return standing(layout.alert, 'attention', 'down');
    if (mode === 'idle') return layout.deskPause ? seated(layout.desk) : standing(layout.hall, 'idle', 'down');
    if (still || status === 'unavailable' || status === 'queued') return seated(layout.desk, 0);
    if (status === 'review') return seated(layout.desk, Math.floor(elapsed / 420) % 2);
    // Energetic fast typing for 'running'
    const typing = Math.floor(elapsed / 130) % 4;
    return seated(layout.desk, typing);
  }

  function create() {
    let actors = new Map();

    function update(seats, now, reset = false) {
      const next = new Map();
      seats.forEach((seat, index) => {
        const key = seat.id ?? seat.x;
        const previous = reset ? undefined : actors.get(key);
        const mode = modeOf(seat.status);
        const layout = previous?.layout && !reset ? previous.layout : seatLayout(seat, index);

        // If seat coordinates changed (e.g., layout change), rebuild layout cleanly.
        const coordsChanged = previous && (previous.layout.desk.x !== layout.desk.x || previous.layout.desk.foot !== layout.desk.foot);
        if (previous && !coordsChanged && previous.mode === mode) {
          previous.status = seat.status;
          finishInteraction(previous, now);
          next.set(key, previous);
          return;
        }
        const from = previous && !coordsChanged ? currentPose(previous, now, false) :
          mode === 'idle' && layout.deskPause ? seated(layout.desk) : undefined;
        next.set(key, {
          mode, layout, status: seat.status, since: now,
          route: from && transition(from, mode, layout),
          leisure: (!coordsChanged && previous?.leisure) || leisureRoute(layout),
          override: null,
        });
      });
      actors = next;
    }

    function pose(seat, now, reducedMotion = false) {
      const actor = actors.get(seat.id ?? seat.x);
      if (actor) return currentPose(actor, now, reducedMotion);
      return standing(seatLayout(seat, 0).hall);
    }

    function pauseActor(key, now, durationMs = 3400, direction = 'down') {
      const actor = actors.get(key);
      if (!actor) return;
      const cur = currentPose(actor, now, false);
      const pausedPose = cur.seated
        ? seated(cur, 0)
        : standing({ x: cur.x, foot: cur.foot }, 'chat', direction);
      const previous = actor.override;
      actor.override = { kind: 'pause', since: previous?.kind === 'pause' ? previous.since : now,
        until: now + durationMs, pose: pausedPose, resume: previous?.kind === 'pause' ? previous.resume : previous };
    }

    function summonIdle(keys, targetSpots, now) {
      let count = 0;
      keys.forEach((key, idx) => {
        const actor = actors.get(key);
        if (!actor || actor.mode !== 'idle') return;
        const from = currentPose(actor, now, false);
        const spot = targetSpots[idx % targetSpots.length];
        const stops = [...safeBridge(from, spot, actor.layout), ...safeBridge(spot, actor.layout.hall, actor.layout)];
        const route = makeRoute(from, stops, walkSpeed * 1.15);
        actor.override = { kind: 'summon', since: now, route, activity: spot.activity || 'tea' };
        count++;
      });
      return count;
    }

    function moving(now) {
      return Array.from(actors.values()).some(actor =>
        actor.mode === 'idle' ||
        actor.status === 'running' ||
        actor.status === 'queued' ||
        actor.status === 'review' ||
        actor.status === 'unavailable' ||
        actor.status === 'attention' ||
        (actor.override && now < (actor.override.until || actor.override.since + actor.override.route.duration)) ||
        (actor.route && now - actor.since < actor.route.duration)
      );
    }

    function interacting() {
      return Array.from(actors.values()).some(actor => actor.override);
    }

    return { update, pose, moving, interacting, pauseActor, summonIdle };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ModelDeskOfficeMotion = api;
}());
