#!/bin/bash

while true
do
   /usr/local/bin/node app.js >>"./logs/info${1}.log" 2>>"./logs/error${1}.log"
   
   EXIT_CODE=$?
   DATE=`date`
   STATUS="Exit on ${DATE} with code ${EXIT_CODE}"
   echo $STATUS >> "./logs/info${1}.log"
   echo $STATUS >> "./logs/error${1}.log"
   echo $STATUS
   
   sleep 1
done
