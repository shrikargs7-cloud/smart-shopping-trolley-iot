const firebaseConfig = {
    apiKey: "AIzaSyBdId6Lqg-zc5o0dTzrArcgS0-6lC5VFD8",
    authDomain: "inventory-fa492.firebaseapp.com",
    databaseURL: "https://inventory-fa492-default-rtdb.firebaseio.com",
    projectId: "inventory-fa492",
    storageBucket: "inventory-fa492.firebasestorage.app",
    messagingSenderId: "541236531884",
    appId: "1:541236531884:web:57e3695632419ea8558509",
    measurementId: "G-BQFZG2SW1W"
};

firebase.initializeApp(firebaseConfig);

const database = firebase.database();
const auth = firebase.auth();
