<?php

namespace App\Http\Controllers;

use App\Models\User;

class UserController extends Controller
{
    public function index()
    {
        return User::all();
    }

    public function store()
    {
        return new User();
    }

    public function destroy(User $user)
    {
        return $user;
    }
}
