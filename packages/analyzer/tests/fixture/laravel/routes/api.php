<?php

use App\Http\Controllers\PostController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::get('/users', [UserController::class, 'index']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/users', [UserController::class, 'store']);
    Route::apiResource('posts', PostController::class)->only(['index', 'show', 'store']);
});

Route::group(['prefix' => 'admin', 'middleware' => ['auth', 'can:admin']], function () {
    Route::delete('/users/{user}', 'App\Http\Controllers\UserController@destroy');
});
