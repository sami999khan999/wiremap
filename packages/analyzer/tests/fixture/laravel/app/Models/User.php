<?php

namespace App\Models;

class User
{
    public function posts()
    {
        return Post::class;
    }
}
