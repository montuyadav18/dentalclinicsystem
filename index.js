const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());

// --- MONGODB CONNECTION CACHING ---
let cachedDb = null;
async function connectToDatabase() {
    if (cachedDb) return cachedDb;
    if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'dental_clinic');
    
    // Ensure Indexes for Appointment Concurrency Prevention
    await db.collection('appointments').createIndex(
        { doctorId: 1, appointmentDate: 1, appointmentTime: 1 },
        { unique: true, partialFilterExpression: { status: { $in: ["Pending", "Confirmed"] } } }
    );
    cachedDb = db;
    return db;
}

// --- UTILITIES ---
const parseCookies = (cookieHeader) => {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(`;`).forEach(cookie => {
        let [name, ...rest] = cookie.split(`=`);
        name = name?.trim();
        if (!name) return;
        list[name] = decodeURIComponent(rest.join(`=`).trim());
    });
    return list;
};

// --- AUTH MIDDLEWARE (For Admin APIs handled here) ---
const authenticateAdmin = (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.admin_token;
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
    try {
        req.admin = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
};

// ==========================================
// PUBLIC APIs
// ==========================================

app.get('/api/clinic', async (req, res) => {
    try {
        const db = await connectToDatabase();
        let settings = await db.collection('settings').findOne({});
        if (!settings) {
            settings = {
                clinicName: "SmileCraft Dental Studio",
                tagline: "Your Smile, Our Passion.",
                phone: "+91 98765 43210",
                email: "hello@smilecraftdental.in",
                address: "201, Harmony Plaza, Link Road, Kandivali West, Mumbai, Maharashtra 400067",
                workingHours: "Mon-Sat: 10AM-8PM | Sun: 10AM-2PM"
            };
        }
        res.json({ success: true, data: settings });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/clinic/services', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const treatments = await db.collection('treatments').find({ isActive: true }).toArray();
        res.json({ success: true, data: treatments });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/clinic/doctors', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const doctors = await db.collection('doctors').find({ isActive: true }).toArray();
        res.json({ success: true, data: doctors });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/appointments/availability', async (req, res) => {
    try {
        const { date, doctorId } = req.query;
        if (!date) return res.status(400).json({ success: false, message: "Date is required" });
        const db = await connectToDatabase();
        const appointments = await db.collection('appointments').find({
            appointmentDate: date,
            ...(doctorId && { doctorId }),
            status: { $in: ["Pending", "Confirmed"] }
        }).toArray();
        
        const bookedSlots = appointments.map(a => a.appointmentTime);
        const allSlots = ["10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "02:00 PM", "02:30 PM", "03:00 PM", "04:00 PM", "05:00 PM", "06:00 PM"];
        const availableSlots = allSlots.filter(slot => !bookedSlots.includes(slot));
        
        res.json({ success: true, data: availableSlots });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/appointments', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const { fullName, phone, email, age, treatmentId, treatmentName, doctorId, doctorName, appointmentDate, appointmentTime } = req.body;
        
        const refId = `SC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const appointment = {
            appointmentId: refId, fullName, phone, email, age, treatmentId, treatmentName, doctorId, doctorName, appointmentDate, appointmentTime, status: "Pending", createdAt: new Date()
        };
        
        await db.collection('appointments').insertOne(appointment);
        res.json({ success: true, data: { appointmentId: refId } });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: "This slot was just booked. Please choose another." });
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post('/api/inquiries', async (req, res) => {
    try {
        const db = await connectToDatabase();
        await db.collection('inquiries').insertOne({ ...req.body, status: "Unread", createdAt: new Date() });
        res.json({ success: true, message: "Inquiry received" });
    } catch (error) { res.status(500).json({ success: false }); }
});

// ==========================================
// ADMIN APIs (Secured)
// ==========================================

app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    if (email !== process.env.ADMIN_EMAIL) return res.status(401).json({ success: false, message: "Invalid credentials" });
    
    const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });
    
    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Secure; Path=/; Max-Age=43200`);
    res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', `admin_token=; HttpOnly; Secure; Path=/; Max-Age=0`);
    res.json({ success: true });
});

app.get('/api/admin/me', authenticateAdmin, (req, res) => { res.json({ success: true, admin: req.admin }); });

app.get('/api/admin/dashboard', authenticateAdmin, async (req, res) => {
    try {
        const db = await connectToDatabase();
        const totalAppointments = await db.collection('appointments').countDocuments();
        const pendingAppointments = await db.collection('appointments').countDocuments({ status: "Pending" });
        const totalTreatments = await db.collection('treatments').countDocuments();
        const totalDoctors = await db.collection('doctors').countDocuments();
        res.json({ success: true, data: { totalAppointments, pendingAppointments, totalTreatments, totalDoctors } });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Generic CRUD endpoints for Admin
const collections = ['appointments', 'treatments', 'doctors', 'inquiries'];
collections.forEach(coll => {
    app.get(`/api/admin/${coll}`, authenticateAdmin, async (req, res) => {
        try {
            const db = await connectToDatabase();
            const data = await db.collection(coll).find({}).sort({createdAt: -1}).toArray();
            res.json({ success: true, data });
        } catch (e) { res.status(500).json({ success: false }); }
    });

    app.post(`/api/admin/${coll}`, authenticateAdmin, async (req, res) => {
        try {
            const db = await connectToDatabase();
            await db.collection(coll).insertOne({ ...req.body, createdAt: new Date() });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ success: false }); }
    });

    app.patch(`/api/admin/${coll}/:id`, authenticateAdmin, async (req, res) => {
        try {
            const db = await connectToDatabase();
            const { _id, ...updateData } = req.body;
            await db.collection(coll).updateOne({ _id: new ObjectId(req.params.id) }, { $set: updateData });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ success: false }); }
    });

    app.delete(`/api/admin/${coll}/:id`, authenticateAdmin, async (req, res) => {
        try {
            const db = await connectToDatabase();
            await db.collection(coll).deleteOne({ _id: new ObjectId(req.params.id) });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ success: false }); }
    });
});

// ==========================================
// PUBLIC WEBSITE (FRONTEND HTML/CSS/JS)
// ==========================================

const PUBLIC_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SmileCraft Dental Studio</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <style>
        :root {
            --primary: #4F7DF3; --soft-blue: #E8F0FF; --mint: #B9F2DD;
            --coral: #FF8F87; --lavender: #DCD4FF; --bg: #F5F7FC;
            --dark: #25304A; --gray: #778198; --white: #FFFFFF;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
        body { background-color: var(--bg); color: var(--dark); overflow-x: hidden; }
        
        /* Claymorphism Base */
        .clay-card {
            background: var(--bg); border-radius: 24px;
            box-shadow: 12px 12px 24px #e1e5ee, -12px -12px 24px #ffffff;
            padding: 2rem; border: 2px solid rgba(255,255,255,0.6);
            transition: transform 0.3s ease;
        }
        .clay-btn {
            background: var(--primary); color: var(--white); border-radius: 16px;
            box-shadow: 6px 6px 12px #c8d0e0, -6px -6px 12px #ffffff;
            padding: 12px 28px; border: none; cursor: pointer; font-weight: 600;
            transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 8px; text-decoration: none;
        }
        .clay-btn:active { box-shadow: inset 4px 4px 8px rgba(0,0,0,0.1), inset -4px -4px 8px rgba(255,255,255,0.2); transform: scale(0.98); }
        .clay-btn.secondary { background: var(--mint); color: var(--dark); }
        .clay-input {
            background: var(--bg); border-radius: 12px; border: none;
            box-shadow: inset 6px 6px 12px #e1e5ee, inset -6px -6px 12px #ffffff;
            padding: 14px 20px; width: 100%; outline: none; margin-bottom: 1rem; color: var(--dark);
        }
        
        /* Layout */
        nav { position: fixed; top: 0; width: 100%; padding: 1.5rem 5%; display: flex; justify-content: space-between; align-items: center; z-index: 100; transition: background 0.3s; }
        nav.scrolled { background: rgba(245, 247, 252, 0.9); backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .logo { font-size: 1.5rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 10px; }
        .nav-links { display: flex; gap: 2rem; }
        .nav-links a { color: var(--dark); text-decoration: none; font-weight: 500; transition: color 0.3s; }
        .nav-links a:hover { color: var(--primary); }
        
        section { padding: 6rem 5%; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; }
        
        /* Hero Section */
        #hero { display: flex; align-items: center; justify-content: space-between; position: relative; flex-direction: row; }
        .hero-text { flex: 1; z-index: 2; }
        .hero-text h1 { font-size: 3.5rem; line-height: 1.2; margin-bottom: 1.5rem; color: var(--dark); }
        .hero-text p { font-size: 1.1rem; color: var(--gray); margin-bottom: 2rem; max-width: 500px; }
        .hero-stats { display: flex; gap: 2rem; margin-top: 3rem; }
        .stat-item h3 { font-size: 1.8rem; color: var(--primary); }
        .hero-3d { flex: 1; height: 500px; position: relative; }
        #canvas-container { width: 100%; height: 100%; }
        
        /* Treatments Section */
        .section-title { text-align: center; margin-bottom: 4rem; }
        .section-title h2 { font-size: 2.5rem; color: var(--dark); margin-bottom: 1rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
        .treatment-card img { width: 100%; height: 200px; object-fit: cover; border-radius: 16px; margin-bottom: 1.5rem; }
        
        /* Booking Section */
        #booking { background: var(--soft-blue); }
        .booking-container { max-width: 800px; margin: 0 auto; background: var(--bg); padding: 3rem; border-radius: 32px; box-shadow: 16px 16px 32px #d1d6e3, -16px -16px 32px #ffffff; }
        .step { display: none; }
        .step.active { display: block; animation: fadeIn 0.5s; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .slot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .slot-btn { background: var(--white); border: 2px solid var(--soft-blue); padding: 10px; border-radius: 12px; cursor: pointer; text-align: center; transition: all 0.2s; }
        .slot-btn.selected { background: var(--primary); color: white; border-color: var(--primary); }
        
        footer { background: var(--dark); color: var(--white); padding: 4rem 5%; text-align: center; }
        
        @media (max-width: 768px) {
            #hero { flex-direction: column; text-align: center; }
            .hero-text h1 { font-size: 2.5rem; }
            .hero-stats { justify-content: center; }
            .nav-links { display: none; }
        }
    </style>
</head>
<body>

    <nav id="navbar">
        <div class="logo"><i data-lucide="smile"></i> SmileCraft</div>
        <div class="nav-links">
            <a href="#hero">Home</a>
            <a href="#about">About</a>
            <a href="#treatments">Treatments</a>
            <a href="#doctors">Doctors</a>
        </div>
        <a href="#booking" class="clay-btn">Book Appointment</a>
    </nav>

    <section id="hero">
        <div class="hero-text gs-reveal">
            <h1>Your Perfect Smile<br>Starts Here.</h1>
            <p>Experience comfortable, advanced, and personalized dental care with our expert team at SmileCraft Studio.</p>
            <div style="display: flex; gap: 1rem; justify-content: flex-start;">
                <a href="#booking" class="clay-btn">Book Now <i data-lucide="calendar"></i></a>
                <a href="#treatments" class="clay-btn secondary">Explore <i data-lucide="arrow-right"></i></a>
            </div>
            <div class="hero-stats">
                <div class="stat-item"><h3>5,000+</h3><p>Happy Smiles</p></div>
                <div class="stat-item"><h3>10+</h3><p>Years Exp.</p></div>
            </div>
        </div>
        <div class="hero-3d gs-reveal">
            <div id="canvas-container"></div>
        </div>
    </section>

    <section id="treatments">
        <div class="section-title gs-reveal">
            <h2>Our Premium Treatments</h2>
            <p>Advanced dental care tailored to your needs</p>
        </div>
        <div class="grid" id="treatments-grid">
            <!-- Dynamic Treatments Loaded Here -->
        </div>
    </section>

    <section id="booking">
        <div class="section-title gs-reveal">
            <h2>Book Your Visit</h2>
            <p>Simple 3-step online booking</p>
        </div>
        <div class="booking-container gs-reveal">
            <!-- Step 1 -->
            <div class="step active" id="step-1">
                <h3>1. What do you need help with?</h3>
                <select id="b-treatment" class="clay-input" style="margin-top: 1rem;"></select>
                <h3>Select Doctor</h3>
                <select id="b-doctor" class="clay-input"></select>
                <button class="clay-btn" onclick="goToStep(2)" style="width: 100%; justify-content: center; margin-top: 1rem;">Next Step</button>
            </div>
            
            <!-- Step 2 -->
            <div class="step" id="step-2">
                <h3>2. Choose Date & Time</h3>
                <input type="date" id="b-date" class="clay-input" style="margin-top: 1rem;" onchange="fetchSlots()">
                <div class="slot-grid" id="slot-container"></div>
                <div style="display:flex; gap:1rem;">
                    <button class="clay-btn secondary" onclick="goToStep(1)">Back</button>
                    <button class="clay-btn" onclick="goToStep(3)" style="flex:1; justify-content: center;">Next Step</button>
                </div>
            </div>
            
            <!-- Step 3 -->
            <div class="step" id="step-3">
                <h3>3. Patient Details</h3>
                <input type="text" id="b-name" class="clay-input" placeholder="Full Name" style="margin-top: 1rem;">
                <input type="tel" id="b-phone" class="clay-input" placeholder="Phone Number">
                <input type="email" id="b-email" class="clay-input" placeholder="Email Address">
                <input type="number" id="b-age" class="clay-input" placeholder="Age">
                <div style="display:flex; gap:1rem;">
                    <button class="clay-btn secondary" onclick="goToStep(2)">Back</button>
                    <button class="clay-btn" onclick="submitBooking()" style="flex:1; justify-content: center;" id="btn-submit">Confirm Booking</button>
                </div>
            </div>
            
            <!-- Step 4 Success -->
            <div class="step" id="step-4" style="text-align: center; padding: 2rem 0;">
                <i data-lucide="check-circle" style="width: 80px; height: 80px; color: var(--mint); margin-bottom: 1rem;"></i>
                <h2>Booking Confirmed!</h2>
                <p>Your Ref ID: <strong id="ref-id"></strong></p>
                <p style="margin: 1rem 0; color: var(--gray);">We have received your appointment request. Our team will contact you shortly.</p>
                <button class="clay-btn" onclick="location.reload()">Back to Home</button>
            </div>
        </div>
    </section>
    
    <footer>
        <h2>SmileCraft Dental Studio</h2>
        <p>201, Harmony Plaza, Mumbai 400067 | +91 98765 43210</p>
        <p style="margin-top:2rem; font-size:0.9rem; color:#aaa;">&copy; 2026 SmileCraft. All rights reserved.</p>
    </footer>

    <script>
        lucide.createIcons();

        // Global State
        let bookingState = { treatmentId: '', doctorId: '', date: '', time: '' };
        
        // Initial Fetch
        async function initData() {
            try {
                // Fetch Dummy Treatments if empty or use defaults
                const res = await fetch('/api/clinic/services');
                const data = await res.json();
                const treatments = data.data.length ? data.data : [
                    { _id: '1', name: 'Teeth Whitening', description: 'Advanced laser whitening.', price: '₹3,999' },
                    { _id: '2', name: 'Dental Implants', description: 'Permanent tooth replacement.', price: '₹25,000' },
                    { _id: '3', name: 'Root Canal', description: 'Painless RCT treatment.', price: '₹2,500' }
                ];
                
                const grid = document.getElementById('treatments-grid');
                const selectT = document.getElementById('b-treatment');
                treatments.forEach(t => {
                    grid.innerHTML += \`
                        <div class="clay-card treatment-card">
                            <h3>\${t.name}</h3>
                            <p style="color:var(--gray); margin: 10px 0;">\${t.description}</p>
                            <h4 style="color:var(--primary); margin-bottom:15px;">Starts at \${t.price}</h4>
                            <button class="clay-btn secondary" onclick="document.getElementById('booking').scrollIntoView()">Book Now</button>
                        </div>
                    \`;
                    selectT.innerHTML += \`<option value="\${t._id}">\${t.name}</option>\`;
                });

                // Fetch Doctors
                const resD = await fetch('/api/clinic/doctors');
                const dataD = await resD.json();
                const doctors = dataD.data.length ? dataD.data : [
                    { _id: 'd1', name: 'Dr. Aarav Mehta' }, { _id: 'd2', name: 'Dr. Priya Sharma' }
                ];
                const selectD = document.getElementById('b-doctor');
                selectD.innerHTML += \`<option value="">Any Available Doctor</option>\`;
                doctors.forEach(d => {
                    selectD.innerHTML += \`<option value="\${d._id}">\${d.name}</option>\`;
                });

                // Min Date
                document.getElementById('b-date').min = new Date().toISOString().split('T')[0];

            } catch (e) { console.error("Error loading data"); }
        }

        // Booking Logic
        function goToStep(step) {
            document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
            document.getElementById('step-' + step).classList.add('active');
            if(step === 2 && document.getElementById('b-date').value) fetchSlots();
        }

        async function fetchSlots() {
            const date = document.getElementById('b-date').value;
            const doctorId = document.getElementById('b-doctor').value;
            if(!date) return;
            const container = document.getElementById('slot-container');
            container.innerHTML = '<p>Loading slots...</p>';
            
            try {
                const res = await fetch(\`/api/appointments/availability?date=\${date}&doctorId=\${doctorId}\`);
                const data = await res.json();
                container.innerHTML = '';
                if(data.data.length === 0) {
                    container.innerHTML = '<p>No slots available on this date.</p>';
                    return;
                }
                data.data.forEach(slot => {
                    const btn = document.createElement('div');
                    btn.className = 'slot-btn';
                    btn.innerText = slot;
                    btn.onclick = () => {
                        document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
                        btn.classList.add('selected');
                        bookingState.time = slot;
                    };
                    container.appendChild(btn);
                });
            } catch(e) { container.innerHTML = 'Error loading slots.'; }
        }

        async function submitBooking() {
            if(!bookingState.time) return alert("Please select a time slot.");
            const payload = {
                treatmentId: document.getElementById('b-treatment').value,
                treatmentName: document.getElementById('b-treatment').options[document.getElementById('b-treatment').selectedIndex].text,
                doctorId: document.getElementById('b-doctor').value,
                doctorName: document.getElementById('b-doctor').options[document.getElementById('b-doctor').selectedIndex]?.text || 'Any',
                appointmentDate: document.getElementById('b-date').value,
                appointmentTime: bookingState.time,
                fullName: document.getElementById('b-name').value,
                phone: document.getElementById('b-phone').value,
                email: document.getElementById('b-email').value,
                age: document.getElementById('b-age').value,
            };
            
            if(!payload.fullName || !payload.phone) return alert("Name and Phone are required.");
            
            document.getElementById('btn-submit').innerText = "Processing...";
            try {
                const res = await fetch('/api/appointments', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                });
                const data = await res.json();
                if(data.success) {
                    document.getElementById('ref-id').innerText = data.data.appointmentId;
                    goToStep(4);
                } else {
                    alert(data.message || "Booking failed.");
                    document.getElementById('btn-submit').innerText = "Confirm Booking";
                }
            } catch(e) { alert("Server error"); document.getElementById('btn-submit').innerText = "Confirm Booking"; }
        }

        // Animations & 3D
        function initAnimations() {
            gsap.registerPlugin(ScrollTrigger);
            gsap.utils.toArray('.gs-reveal').forEach(elem => {
                gsap.fromTo(elem, 
                    { y: 50, opacity: 0 },
                    { y: 0, opacity: 1, duration: 1, ease: "power3.out", scrollTrigger: { trigger: elem, start: "top 85%" } }
                );
            });
            
            // Navbar Scroll
            window.addEventListener('scroll', () => {
                const nav = document.getElementById('navbar');
                if (window.scrollY > 50) nav.classList.add('scrolled');
                else nav.classList.remove('scrolled');
            });
        }

        function init3DTooth() {
            try {
                const container = document.getElementById('canvas-container');
                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
                const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
                renderer.setSize(container.clientWidth, container.clientHeight);
                container.appendChild(renderer.domElement);

                // Procedural abstract tooth (rounded box + roots)
                const group = new THREE.Group();
                const crownGeo = new THREE.BoxGeometry(2, 2.5, 2);
                const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.1 });
                const crown = new THREE.Mesh(crownGeo, mat);
                crown.position.y = 1;
                group.add(crown);
                
                const rootGeo = new THREE.CylinderGeometry(0.5, 0.2, 2);
                const root1 = new THREE.Mesh(rootGeo, mat);
                root1.position.set(-0.5, -1, 0);
                const root2 = new THREE.Mesh(rootGeo, mat);
                root2.position.set(0.5, -1, 0);
                group.add(root1); group.add(root2);

                scene.add(group);

                const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
                scene.add(ambientLight);
                const dirLight = new THREE.DirectionalLight(0x4F7DF3, 0.8);
                dirLight.position.set(5, 5, 5);
                scene.add(dirLight);
                const fillLight = new THREE.DirectionalLight(0xB9F2DD, 0.5);
                fillLight.position.set(-5, 0, 5);
                scene.add(fillLight);

                camera.position.z = 8;

                function animate() {
                    requestAnimationFrame(animate);
                    group.rotation.y += 0.005;
                    group.position.y = Math.sin(Date.now() * 0.002) * 0.2;
                    renderer.render(scene, camera);
                }
                animate();
                
                window.addEventListener('resize', () => {
                    camera.aspect = container.clientWidth / container.clientHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(container.clientWidth, container.clientHeight);
                });
            } catch (e) { console.log("WebGL not supported"); }
        }

        window.onload = () => {
            initData();
            initAnimations();
            init3DTooth();
        };
    </script>
</body>
</html>
`;

app.get('*', (req, res) => res.send(PUBLIC_HTML));

module.exports = app;
