import express from "express";
import fetch from "node-fetch";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import cors from "cors"; // ← подключаем CORS

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ===== Настройка CORS =====
// В production лучше указывать конкретный домен фронтенда вместо '*'
app.use(cors({
  origin: 'https://ferniex-minigame.vercel.app',
  credentials: true
}));
// ====== Регистрация ======
app.post("/api/register", async (req,res)=>{
  const {username,password} = req.body;
  if(!username || !password) return res.json({success:false,error:"Все поля обязательны"});

  try{
    // Проверка, есть ли уже такой пользователь
    const check = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?username=eq.${username}`,{
      headers:{
        apikey:process.env.SUPABASE_KEY,
        Authorization:`Bearer ${process.env.SUPABASE_KEY}`
      }
    });
    const checkData = await check.json();
    if(checkData.length) return res.json({success:false,error:"Пользователь уже существует"});

    const hash = await bcrypt.hash(password,10);

    // Создание пользователя
    const create = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users`,{
      method:"POST",
      headers:{
        apikey:process.env.SUPABASE_KEY,
        Authorization:`Bearer ${process.env.SUPABASE_KEY}`,
        "Content-Type":"application/json"
      },
      body: JSON.stringify({username,password_hash:hash,balance:1000,role:"user"})
    });
    if(create.ok) res.json({success:true,message:"Регистрация успешна"});
    else res.json({success:false,error:"Ошибка при создании"});
  }catch(e){
    console.error(e);
    res.json({success:false,error:"Ошибка сервера"});
  }
});

// ====== Вход ======
app.post("/api/login", async (req,res)=>{
  const {username,password} = req.body;
  if(!username || !password) return res.json({success:false,error:"Все поля обязательны"});
  try{
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?username=eq.${username}`,{
      headers:{
        apikey:process.env.SUPABASE_KEY,
        Authorization:`Bearer ${process.env.SUPABASE_KEY}`
      }
    });
    const data = await response.json();
    if(!data.length) return res.json({success:false,error:"Пользователь не найден"});
    const user = data[0];
    const match = await bcrypt.compare(password,user.password_hash);
    if(!match) return res.json({success:false,error:"Неверный пароль"});
    res.json({success:true,userId:user.id});
  }catch(e){
    console.error(e);
    res.json({success:false,error:"Ошибка сервера"});
  }
});

// ====== Баланс ======
app.get("/api/balance/:userId", async (req,res)=>{
  const userId = req.params.userId;
  try{
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,{
      headers:{
        apikey:process.env.SUPABASE_KEY,
        Authorization:`Bearer ${process.env.SUPABASE_KEY}`
      }
    });
    const data = await response.json();
    if(!data.length) return res.status(404).json({error:"Пользователь не найден"});
    res.json({balance:data[0].balance});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Ошибка сервера"});
  }
});

const port = process.env.PORT || 3000;
app.listen(port,()=>console.log(`Server running on port ${port}`));
