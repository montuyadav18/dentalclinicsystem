const express = require('express');
const app = express();

const ADMIN_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - SmileCraft</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --primary: #4F7DF3; --bg: #F5F7FC; --dark: #25304A; --white: #FFFFFF;
            --mint: #B9F2DD; --danger: #FF8F87; --gray: #778198;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
        body { background: var(--bg); display: flex; height: 100vh; overflow: hidden; color: var(--dark); }
        
        /* Clay Components */
        .clay-card { background: var(--bg); border-radius: 20px; box-shadow: 8px 8px 16px #e1e5ee, -8px -8px 16px #ffffff; padding: 1.5rem; }
        .clay-input { background: var(--bg); border: none; border-radius: 12px; box-shadow: inset 4px 4px 8px #e1e5ee, inset -4px -4px 8px #ffffff; padding: 12px; width: 100%; outline: none; margin-bottom: 1rem; }
        .clay-btn { background: var(--primary); color: white; border: none; border-radius: 12px; padding: 10px 20px; cursor: pointer; box-shadow: 4px 4px 8px #c8d0e0, -4px -4px 8px #ffffff; font-weight: 500; transition: transform 0.1s; }
        .clay-btn:active { transform: scale(0.95); }
        .clay-btn.danger { background: var(--danger); }
        .clay-btn.success { background: var(--mint); color: var(--dark); }
        
        /* Login Screen */
        #login-screen { position: fixed; inset: 0; background: var(--bg); display: flex; justify-content: center; align-items: center; z-index: 1000; }
        .login-box { width: 400px; text-align: center; }
        
        /* Layout */
        aside { width: 250px; background: var(--white); padding: 2rem 1rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: 4px 0 10px rgba(0,0,0,0.02); z-index: 10; }
        aside h2 { color: var(--primary); text-align: center; margin-bottom: 2rem; }
        .nav-item { padding: 12px 16px; border-radius: 12px; cursor: pointer; display: flex; align-items: center; gap: 12px; color: var(--gray); font-weight: 500; transition: all 0.2s; }
        .nav-item.active, .nav-item:hover { background: var(--soft-blue); color: var(--primary); box-shadow: inset 2px 2px 5px rgba(0,0,0,0.02); }
        
        main { flex: 1; padding: 2rem; overflow-y: auto; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
        
        /* Table */
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e1e5ee; }
        th { color: var(--gray); font-weight: 500; }
        .status { padding: 4px 10px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; }
        .status.Pending { background: #FFE6A7; color: #b08c1a; }
        .status.Confirmed { background: var(--mint); color: #2d8a63; }
        .status.Cancelled { background: var(--danger); color: white; }
        
        .view-section { display: none; }
        .view-section.active { display: block; animation: fadeIn 0.3s; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        
        .grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
    </style>
</head>
<body>

    <!-- Login Screen -->
    <div id="login-screen">
        <div class="clay-card login-box">
            <h2 style="margin-bottom:1.5rem; color:var(--primary);">Admin Secure Login</h2>
            <input type="email" id="l-email" class="clay-input" placeholder="Admin Email">
            <input type="password" id="l-password" class="clay-input" placeholder="Password">
            <button class="clay-btn" style="width:100%;" onclick="login()">Login</button>
            <p id="l-err" style="color:var(--danger); margin-top:1rem; display:none;">Invalid Credentials</p>
        </div>
    </div>

    <!-- Dashboard Layout -->
    <aside>
        <h2><i data-lucide="shield"></i> Admin Panel</h2>
        <div class="nav-item active" onclick="nav('dashboard')"><i data-lucide="layout-dashboard"></i> Dashboard</div>
        <div class="nav-item" onclick="nav('appointments')"><i data-lucide="calendar"></i> Appointments</div>
        <div class="nav-item" onclick="nav('treatments')"><i data-lucide="activity"></i> Treatments</div>
        <div class="nav-item" style="margin-top:auto;" onclick="logout()"><i data-lucide="log-out"></i> Logout</div>
    </aside>

    <main>
        <!-- Dashboard Section -->
        <div id="sec-dashboard" class="view-section active">
            <div class="header">
                <h1>Overview</h1>
            </div>
            <div class="grid-cards" id="dash-stats">
                <div class="clay-card"><h3>Loading...</h3></div>
            </div>
        </div>

        <!-- Appointments Section -->
        <div id="sec-appointments" class="view-section">
            <div class="header">
                <h1>Appointments</h1>
            </div>
            <div class="clay-card" style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Ref ID</th>
                            <th>Patient</th>
                            <th>Date & Time</th>
                            <th>Treatment</th>
                            <th>Doctor</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="apt-table"></tbody>
                </table>
            </div>
        </div>

        <!-- Treatments Section -->
        <div id="sec-treatments" class="view-section">
            <div class="header">
                <h1>Manage Treatments</h1>
            </div>
            <div class="clay-card" style="margin-bottom: 2rem;">
                <h3>Add New Treatment</h3>
                <div style="display:flex; gap:1rem; margin-top:1rem;">
                    <input type="text" id="t-name" class="clay-input" placeholder="Treatment Name">
                    <input type="text" id="t-price" class="clay-input" placeholder="Price (e.g. ₹2,500)">
                    <button class="clay-btn" onclick="addTreatment()">Add</button>
                </div>
            </div>
            <div class="clay-card" style="overflow-x: auto;">
                <table>
                    <thead><tr><th>Name</th><th>Price</th><th>Actions</th></tr></thead>
                    <tbody id="trt-table"></tbody>
                </table>
            </div>
        </div>
    </main>

    <script>
        lucide.createIcons();

        // Check Auth on Load
        window.onload = async () => {
            const res = await fetch('/api/admin/me');
            if(res.ok) {
                document.getElementById('login-screen').style.display = 'none';
                loadDashboard();
            }
        };

        async function login() {
            const email = document.getElementById('l-email').value;
            const password = document.getElementById('l-password').value;
            const res = await fetch('/api/admin/login', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({email, password})
            });
            if(res.ok) {
                document.getElementById('login-screen').style.display = 'none';
                loadDashboard();
            } else {
                document.getElementById('l-err').style.display = 'block';
            }
        }

        async function logout() {
            await fetch('/api/admin/logout', { method: 'POST' });
            location.reload();
        }

        function nav(section) {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.getElementById('sec-' + section).classList.add('active');
            event.currentTarget.classList.add('active');
            if(section === 'dashboard') loadDashboard();
            if(section === 'appointments') loadAppointments();
            if(section === 'treatments') loadTreatments();
        }

        async function loadDashboard() {
            const res = await fetch('/api/admin/dashboard');
            const data = await res.json();
            if(data.success) {
                document.getElementById('dash-stats').innerHTML = \`
                    <div class="clay-card"><h2 style="font-size:2.5rem; color:var(--primary);">\${data.data.totalAppointments}</h2><p>Total Appointments</p></div>
                    <div class="clay-card"><h2 style="font-size:2.5rem; color:var(--danger);">\${data.data.pendingAppointments}</h2><p>Pending Requests</p></div>
                    <div class="clay-card"><h2 style="font-size:2.5rem; color:var(--mint);">\${data.data.totalTreatments}</h2><p>Active Treatments</p></div>
                \`;
            }
        }

        async function loadAppointments() {
            const res = await fetch('/api/admin/appointments');
            const data = await res.json();
            const tbody = document.getElementById('apt-table');
            tbody.innerHTML = '';
            data.data.forEach(a => {
                tbody.innerHTML += \`
                    <tr>
                        <td>\${a.appointmentId}</td>
                        <td>\${a.fullName}<br><small style="color:var(--gray)">\${a.phone}</small></td>
                        <td>\${a.appointmentDate} at \${a.appointmentTime}</td>
                        <td>\${a.treatmentName}</td>
                        <td>\${a.doctorName}</td>
                        <td><span class="status \${a.status}">\${a.status}</span></td>
                        <td>
                            \${a.status === 'Pending' ? \`<button class="clay-btn success" style="padding:4px 8px; font-size:0.8rem;" onclick="updateStatus('\${a._id}', 'Confirmed')">Confirm</button>\` : ''}
                            <button class="clay-btn danger" style="padding:4px 8px; font-size:0.8rem;" onclick="updateStatus('\${a._id}', 'Cancelled')">Cancel</button>
                        </td>
                    </tr>
                \`;
            });
        }

        async function updateStatus(id, status) {
            await fetch(\`/api/admin/appointments/\${id}\`, {
                method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status})
            });
            loadAppointments();
            loadDashboard();
        }

        async function loadTreatments() {
            const res = await fetch('/api/admin/treatments');
            const data = await res.json();
            const tbody = document.getElementById('trt-table');
            tbody.innerHTML = '';
            data.data.forEach(t => {
                tbody.innerHTML += \`
                    <tr>
                        <td>\${t.name}</td>
                        <td>\${t.price}</td>
                        <td><button class="clay-btn danger" style="padding:4px 8px; font-size:0.8rem;" onclick="deleteTreatment('\${t._id}')">Delete</button></td>
                    </tr>
                \`;
            });
        }

        async function addTreatment() {
            const name = document.getElementById('t-name').value;
            const price = document.getElementById('t-price').value;
            if(!name || !price) return;
            await fetch('/api/admin/treatments', {
                method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name, price, isActive: true})
            });
            document.getElementById('t-name').value = '';
            document.getElementById('t-price').value = '';
            loadTreatments();
        }

        async function deleteTreatment(id) {
            await fetch(\`/api/admin/treatments/\${id}\`, { method: 'DELETE' });
            loadTreatments();
        }
    </script>
</body>
</html>
`;

app.get('*', (req, res) => res.send(ADMIN_HTML));

module.exports = app;
