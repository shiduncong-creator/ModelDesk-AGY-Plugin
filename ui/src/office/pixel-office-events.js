(function () {
  'use strict';

  const defaultAgents = ['doubao_desktop', 'qoder', 'workbuddy', 'dsh'];
  const activeStates = new Set(['queued', 'dispatching', 'running']);
  const terminalStates = new Set(['completed', 'failed', 'cancelled', 'recovery_pending']);
  const unresolvedDelivery = new Set(['outcome_unknown', 'cleanup_attention', 'finalizing']);
  // The API returns at most 150 tasks per snapshot. Keep recent observations
  // when a task temporarily drops out of that window, without unbounded state.
  const observationLimit = 600;

  function readTask(task, summarize, isAccepted, observedTime) {
    const code = summarize(task)?.code;
    const result = task.execution_result;
    const review = result?.schema_version === 1 ? result.review : task.review;
    const terminal = terminalStates.has(task.status);
    const settled = result?.controller_finalization?.state;
    const completed = task.status === 'completed';
    const progressAt = typeof task.last_progress_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(task.last_progress_at)
      ? Date.parse(task.last_progress_at) : NaN;
    return {
      agent: task.engine,
      active: activeStates.has(task.status),
      running: task.status === 'running' && !unresolvedDelivery.has(code) && task[task.engine]?.outcome_unknown !== true,
      progressAt: Number.isFinite(progressAt) && progressAt <= observedTime ? progressAt : null,
      completed,
      delivered: completed && !unresolvedDelivery.has(code) &&
        settled !== 'pending' && settled !== 'attention' && task[task.engine]?.outcome_unknown !== true,
      accepted: terminal && isAccepted(task) === true,
      blocked: terminal && (code === 'blocked' ||
        (!code && review?.state === 'blocked' && review?.unreadable !== true)),
      returned: terminal && (code === 'returned' ||
        (review?.state === 'returned' && review?.unreadable !== true)),
      reviewTime: task.review?.updated_at,
    };
  }

  function observedTransition(task, current, previous, generation, lastTime, observedTime) {
    if (!previous) {
      const created = typeof task.created_at === 'string' ? Date.parse(task.created_at) : NaN;
      if (!(created > lastTime && created <= observedTime)) return null;
      if (current.active) return 'dispatch';
      const ended = typeof task.ended_at === 'string' ? Date.parse(task.ended_at) : NaN;
      if (ended >= created && ended <= observedTime && !current.accepted) {
        if (current.blocked) return 'blocked';
        if (current.delivered && !current.returned) return 'deliver';
      }
      return null;
    }
    if (previous.generation !== generation - 1 || previous.agent !== current.agent) return null;
    if (current.accepted && !previous.accepted) return 'accept';
    if (current.blocked && !previous.blocked && !current.accepted) return 'blocked';
    if (current.returned && !previous.returned && !current.accepted && !current.blocked) return 'return';
    if (current.delivered && !previous.delivered && previous.sawActive &&
        !current.blocked && !current.returned) return 'deliver';
    if (current.running && previous.running && current.progressAt !== null &&
        current.progressAt > (previous.progressAt ?? lastTime)) return 'progress';
    return null;
  }

  function createTracker(agentIds = defaultAgents) {
    const officeAgents = new Set(agentIds);
    const observations = new Map();
    let scope, generation = 0, lastTime = NaN;

    function reset() {
      observations.clear();
      scope = undefined;
      generation = 0;
      lastTime = NaN;
    }

    function observe({ tasks, scopeKey, sync, summary, accepted, observedAt, snapshotStartedAt }) {
      if (sync !== 'ready') {
        reset();
        return [];
      }
      if (scopeKey !== scope) reset();
      scope = scopeKey;
      const suppliedTime = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
      const observedTime = Number.isFinite(suppliedTime) ? suppliedTime : Date.now();
      const changes = [];
      generation += 1;

      for (const task of tasks) {
        if (typeof task?.id !== 'string' || !task.id || !officeAgents.has(task.engine)) continue;
        const previous = observations.get(task.id);
        if (previous?.generation === generation) continue;
        const current = readTask(task, summary, accepted, observedTime);
        const sameAgent = previous?.agent === current.agent;
        const returnedAt = sameAgent ? previous.returnedAt : null;
        const blockedAt = sameAgent ? previous.blockedAt : null;
        // A prior review may still appear alongside a retried execution's
        // status. Only a newer review describes another genuine return.
        if (returnedAt && current.reviewTime === returnedAt && !previous.returned) current.returned = false;
        if (blockedAt && current.reviewTime === blockedAt && !previous.blocked) current.blocked = false;
        const kind = generation === 1 ? null :
          observedTransition(task, current, previous, generation, lastTime, observedTime);
        if (kind) changes.push({ kind, agent: current.agent, id: task.id, title: task.title || task.id, task });

        const continuous = sameAgent && previous.generation === generation - 1;
        const startsAnotherAttempt = continuous && current.active && !previous.active;
        const sameAttempt = sameAgent && !startsAnotherAttempt;
        observations.delete(task.id);
        observations.set(task.id, {
          ...current, generation,
          // Once observed, a completion or review must not reanimate after a
          // transient unreadable record or after dropping out of the snapshot.
          delivered: current.delivered || (sameAttempt && previous.delivered),
          accepted: current.accepted || (sameAgent && previous.accepted),
          returned: current.returned || (sameAttempt && previous.returned),
          returnedAt: current.returned && current.reviewTime ? current.reviewTime : returnedAt,
          blocked: current.blocked || (sameAttempt && previous.blocked),
          blockedAt: current.blocked && current.reviewTime ? current.reviewTime : blockedAt,
          progressAt: sameAgent && previous.progressAt !== null &&
            (current.progressAt === null || previous.progressAt > current.progressAt) ? previous.progressAt : current.progressAt,
          sawActive: current.active || (current.completed && continuous && previous.sawActive),
        });
      }
      while (observations.size > observationLimit) observations.delete(observations.keys().next().value);
      const started = typeof snapshotStartedAt === 'string' ? Date.parse(snapshotStartedAt) : NaN;
      // If a task was created while the API assembled the previous snapshot,
      // it may only become visible on this poll. Prefer the earlier boundary.
      lastTime = Number.isFinite(started) ? Math.min(started, observedTime) : observedTime;
      return changes;
    }

    return { observe, reset };
  }

  const api = { createTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ModelDeskOfficeEvents = api;
}());
