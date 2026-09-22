/**
 * CCD Node.js Middleware (PostgreSQL / Supabase Version)
 * Requirements: npm install express pg axios uuid dotenv
 */
require('dotenv').config(); // Loads variables from a .env file
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Environment variables
const API_SECRET = process.env.API_SECRET || 'YOUR_SECURE_WEBHOOK_SECRET';
const IMAGE_GEN_API_KEY = process.env.IMAGE_GEN_API_KEY || 'YOUR_NANO_BANANA_KEY';

// Connect to Supabase using the connection string provided in their dashboard
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for connecting to Supabase from external servers
});

// Middleware to authenticate Google Apps Script requests
const authenticateWebhook = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader === `Bearer ${API_SECRET}`) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Endpoint 1: Receive data from Google Docs and update/insert Character Profiles
app.post('/api/update-character', authenticateWebhook, async (req, res) => {
    const { name, traits, outfit } = req.body;
    if (!name) return res.status(400).json({ error: 'Character name is required' });

    try {
        // Check if character exists (Postgres uses $1, $2 for parameterized queries)
        const result = await pool.query('SELECT id FROM character_profiles WHERE character_name = $1', [name]);
        let charId;

        if (result.rows.length > 0) {
            charId = result.rows[0].id;
            await pool.query(
                'UPDATE character_profiles SET base_physical_traits = $1, current_outfit = $2, updated_at = NOW() WHERE id = $3',
                [traits, outfit, charId]
            );
        } else {
            charId = uuidv4();
            await pool.query(
                'INSERT INTO character_profiles (id, character_name, base_physical_traits, current_outfit) VALUES ($1, $2, $3, $4)',
                [charId, name, traits, outfit]
            );
        }
        res.status(200).json({ message: 'Character synced successfully', id: charId });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint 2: Trigger Image Generation utilizing database consistency logic
app.post('/api/generate-image', async (req, res) => {
    const { character_name, action_setting } = req.body;

    try {
        // 1. Fetch Core Identity
        const charResult = await pool.query('SELECT * FROM character_profiles WHERE character_name = $1', [character_name]);
        if (charResult.rows.length === 0) return res.status(404).json({ error: 'Character not found' });
        const char = charResult.rows[0];

        // 2. Fetch Reference Assets for Identity Lock
        const refResult = await pool.query('SELECT image_url FROM reference_assets WHERE character_id = $1', [char.id]);
        const referenceUrls = refResult.rows.map(row => row.image_url);

        // 3. Strict Prompt Concatenation Rule
        const finalPrompt = `${char.base_physical_traits}, wearing ${char.current_outfit}, ${action_setting}, masterpiece, high quality, consistent character design`;

        // 4. API Request to Image Model
        const apiPayload = {
            prompt: finalPrompt,
            image_input: referenceUrls, 
            seed: char.canonical_seed || Math.floor(Math.random() * 1000000000),
            reference_weight: 0.85 
        };

        console.log("Sending Payload to Generation API:", apiPayload);
        
        // MOCK API CALL - Replace with actual fetch to your chosen model
        const mockOutputUrl = "https://mock-image-url.com/generated.png";

        // 5. Save to Ledger for Version Control
        await pool.query(
            'INSERT INTO generation_ledger (character_id, final_prompt, used_seed, generated_image_url) VALUES ($1, $2, $3, $4)',
            [char.id, finalPrompt, apiPayload.seed, mockOutputUrl]
        );

        res.status(200).json({ 
            message: 'Image generated and logged', 
            url: mockOutputUrl,
            prompt_used: finalPrompt
        });

    } catch (error) {
        console.error("Generation pipeline error:", error);
        res.status(500).json({ error: 'Pipeline failed' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`CCD Middleware running on port ${PORT}`);
});