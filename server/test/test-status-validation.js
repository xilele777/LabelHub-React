/**
 * Quick integration test for backend status transition validation.
 * Starts the server, runs HTTP requests, validates responses, then exits.
 */
const http = require('http');
const { spawn } = require('child_process');

const PORT = 3099; // Use a non-default port to avoid conflict

let childProcess;
let authToken = '';
let annotatorToken = '';
let reviewerToken = '';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const useToken = token !== undefined ? token : authToken;
    const opts = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(useToken ? { Authorization: `Bearer ${useToken}` } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForServer(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: PORT,
            path: '/api/health',
            method: 'GET',
          },
          (res) => {
            res.resume();
            resolve();
          },
        );
        req.on('error', reject);
        req.setTimeout(500, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.end();
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

async function run() {
  // Start server as a child process
  childProcess = spawn(process.execPath, ['index.js'], {
    cwd: __dirname + '/..',
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });

  // Wait for server to be ready
  const ready = await waitForServer();
  if (!ready) {
    console.error('❌ Server did not start in time');
    cleanup(1);
    return;
  }
  console.log('✔ Server is ready on port ' + PORT);

  let passed = 0;
  let failed = 0;

  function assert(name, condition, detail) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name} — ${detail}`);
      failed++;
    }
  }

  // ─── Login to get auth tokens ──────
  console.log('\n🔐 Logging in as owner...');
  const loginRes = await request(
    'POST',
    '/api/auth/login',
    {
      username: 'o',
      password: '123',
    },
    null,
  );
  authToken = loginRes.body?.data?.token || '';
  if (!authToken) {
    console.log('  ⚠️  Could not get owner token:', JSON.stringify(loginRes.body));
  } else {
    console.log('  ✔ Got owner token');
  }

  console.log('🔐 Logging in as annotator...');
  const annLoginRes = await request(
    'POST',
    '/api/auth/login',
    {
      username: 'a',
      password: '123',
    },
    null,
  );
  annotatorToken = annLoginRes.body?.data?.token || '';
  if (!annotatorToken) {
    console.log('  ⚠️  Could not get annotator token:', JSON.stringify(annLoginRes.body));
  } else {
    console.log('  ✔ Got annotator token');
  }

  console.log('🔐 Logging in as reviewer...');
  const revLoginRes = await request(
    'POST',
    '/api/auth/login',
    {
      username: 'r',
      password: '123',
    },
    null,
  );
  reviewerToken = revLoginRes.body?.data?.token || '';
  if (!reviewerToken) {
    console.log('  ⚠️  Could not get reviewer token:', JSON.stringify(revLoginRes.body));
  } else {
    console.log('  ✔ Got reviewer token');
  }

  // ─── Test: Task status transitions ──────────────────
  console.log('\n📋 Testing Task Status Transitions:');

  const tasksRes = await request('GET', '/api/tasks');
  const tasks = tasksRes.body?.data?.items || [];
  console.log(`  Found ${tasks.length} tasks`);

  const draftTask = tasks.find((t) => t.status === 'draft');
  const endedTask = tasks.find((t) => t.status === 'ended');
  const inProgressTask = tasks.find((t) => t.status === 'in_progress');

  if (draftTask) {
    // Legal: draft → in_progress (publishing a draft task)
    const res1 = await request('PUT', `/api/tasks/${draftTask.id}`, { status: 'in_progress' });
    assert(
      'draft → in_progress (legal)',
      res1.body.code === 200,
      `got ${res1.body.code}: ${res1.body.message}`,
    );

    // Revert: in_progress → draft should be illegal
    const res1b = await request('PUT', `/api/tasks/${draftTask.id}`, { status: 'draft' });
    assert(
      'in_progress → draft (illegal, should 400)',
      res1b.body.code === 400,
      `got ${res1b.body.code}: ${res1b.body.message}`,
    );

    // Revert properly: in_progress → ended
    const res1c = await request('PUT', `/api/tasks/${draftTask.id}`, { status: 'ended' });
    // this should succeed
    if (res1c.body.code !== 200) {
      console.log('  ⚠️  Could not revert task to ended:', res1c.body.message);
    }
  } else {
    console.log('  ⚠️  No draft task found in seed data');
  }

  if (endedTask) {
    // Illegal: ended → draft (ended is a terminal state)
    const res2 = await request('PUT', `/api/tasks/${endedTask.id}`, { status: 'draft' });
    assert(
      'ended → draft (illegal, should 400)',
      res2.body.code === 400,
      `got ${res2.body.code}: ${res2.body.message}`,
    );

    // Illegal: ended → in_progress
    const res2b = await request('PUT', `/api/tasks/${endedTask.id}`, { status: 'in_progress' });
    assert(
      'ended → in_progress (illegal, should 400)',
      res2b.body.code === 400,
      `got ${res2b.body.code}: ${res2b.body.message}`,
    );
  }

  if (inProgressTask) {
    // Illegal: in_progress → draft (cannot go backwards)
    const res3 = await request('PUT', `/api/tasks/${inProgressTask.id}`, { status: 'draft' });
    assert(
      'in_progress → draft (illegal, should 400)',
      res3.body.code === 400,
      `got ${res3.body.code}: ${res3.body.message}`,
    );

    // Legal: in_progress → ended
    const res3b = await request('PUT', `/api/tasks/${inProgressTask.id}`, { status: 'ended' });
    assert(
      'in_progress → ended (legal)',
      res3b.body.code === 200,
      `got ${res3b.body.code}: ${res3b.body.message}`,
    );
  }

  // ─── Test: Annotation Item status transitions ──────────
  console.log('\n📝 Testing Annotation Item Status Transitions:');

  const itemsRes = await request('GET', '/api/annotation-items');
  const items = itemsRes.body?.data?.items || [];
  console.log(`  Found ${items.length} annotation items`);

  const pendingItem = items.find((i) => i.status === 'pending');
  const reviewedItem = items.find((i) => i.status === 'reviewed');
  const rejectedItem = items.find((i) => i.status === 'rejected');
  const draftItem = items.find((i) => i.status === 'draft');
  const submittedItem = items.find((i) => i.status === 'submitted');
  const pendingReviewItem = items.find((i) => i.status === 'pending_review');

  if (pendingItem) {
    // Legal: pending → draft (save-draft) — requires annotator role
    const res4 = await request(
      'PUT',
      `/api/annotation-items/${pendingItem.id}/save-draft`,
      {
        annotationData: { test: 1 },
        version: pendingItem.version,
      },
      annotatorToken,
    );
    assert(
      'pending → draft via save-draft (legal)',
      res4.body.code === 200,
      `got ${res4.body.code}: ${res4.body.message}`,
    );

    // Legal: pending → submitted (can submit directly without saving draft first)
    // 后端同步规则预审：允许从 pending 直接提交，无需先保存草稿
    const anotherPending = items.filter((i) => i.status === 'pending')[1];
    if (anotherPending) {
      const res4b = await request(
        'PUT',
        `/api/annotation-items/${anotherPending.id}/submit`,
        {
          annotationData: { test: 1 },
          version: anotherPending.version,
        },
        annotatorToken,
      );
      assert(
        'pending → pending_review via submit (legal, auto rule review)',
        res4b.body.code === 200,
        `got ${res4b.body.code}: ${res4b.body.message}`,
      );
    }
  }

  if (draftItem) {
    // Legal: draft → pending_review after synchronous rule review.
    const res4c = await request(
      'PUT',
      `/api/annotation-items/${draftItem.id}/submit`,
      {
        annotationData: { test: 1 },
        version: draftItem.version,
      },
      annotatorToken,
    );
    assert(
      'draft → pending_review via submit (legal)',
      res4c.body.code === 200,
      `got ${res4c.body.code}: ${res4c.body.message}`,
    );
  }

  if (reviewedItem) {
    // Illegal: reviewed → submitted (reviewed is a terminal state)
    const res5 = await request('PUT', `/api/annotation-items/${reviewedItem.id}/submit`, {
      annotationData: { test: 1 },
    });
    assert(
      'reviewed → submitted via submit (illegal, should 400)',
      res5.body.code === 400,
      `got ${res5.body.code}: ${res5.body.message}`,
    );

    // Illegal: reviewed → pending via generic PUT
    const res6 = await request('PUT', `/api/annotation-items/${reviewedItem.id}`, {
      status: 'pending',
    });
    assert(
      'reviewed → pending via generic PUT (illegal, should 400)',
      res6.body.code === 400,
      `got ${res6.body.code}: ${res6.body.message}`,
    );
  }

  if (rejectedItem) {
    // Legal: rejected → pending_review after resubmission and synchronous rule review.
    const res7 = await request(
      'PUT',
      `/api/annotation-items/${rejectedItem.id}/resubmit`,
      {
        annotationData: { test: 2 },
        version: rejectedItem.version,
      },
      annotatorToken,
    );
    assert(
      'rejected → pending_review via resubmit (legal)',
      res7.body.code === 200,
      `got ${res7.body.code}: ${res7.body.message}`,
    );
  }

  if (pendingReviewItem) {
    // Legal: pending_review → reviewed (approve) — requires reviewer role
    const res8 = await request(
      'PUT',
      `/api/annotation-items/${pendingReviewItem.id}/approve`,
      {
        reason: 'test approve',
        version: pendingReviewItem.version,
      },
      reviewerToken,
    );
    assert(
      'pending_review → reviewed via approve (legal)',
      res8.body.code === 200,
      `got ${res8.body.code}: ${res8.body.message}`,
    );
  }

  // ─── Test: Generic PUT on annotation-items ────────────
  console.log('\n🔧 Testing Generic PUT on Annotation Items:');

  // Use a fresh pending item (may have been changed to draft above)
  const freshItems = (await request('GET', '/api/annotation-items')).body?.data?.items || [];
  const freshPending = freshItems.find((i) => i.status === 'pending');

  if (freshPending) {
    // Illegal: pending → reviewed via generic PUT (skipping steps)
    const res9 = await request('PUT', `/api/annotation-items/${freshPending.id}`, {
      status: 'reviewed',
    });
    assert(
      'pending → reviewed via generic PUT (illegal, should 400)',
      res9.body.code === 400,
      `got ${res9.body.code}: ${res9.body.message}`,
    );
  }

  // ─── Summary ──────────────────────────────────────────
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  cleanup(failed > 0 ? 1 : 0);
}

function cleanup(exitCode) {
  if (childProcess) {
    childProcess.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 300);
}

run().catch((err) => {
  console.error('Test error:', err);
  cleanup(1);
});
